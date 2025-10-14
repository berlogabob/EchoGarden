let ws;                                    // optional Wi-Fi socket
let port, reader, buffer = "";             // Web Serial
const BAUD = 115200;

let bandOffset = { pos:0, neu:0, neg:0 };   // slow scroll offsets

let highlight = { text:"", band:"neutral", x:0, y:0, alpha:0, ttl:0 };

let maskImg, wordsG, lightG;               // images & layers
let gridStep = 8, maskCutoff = 58;
let mixSlider;

let reveal = 0.75;         // fraction of characters shown (0..1)
let revealSlider;          // testing UI


let isPaused = false;
let masks = [];
let maskIdx = 0;   
let fading = false;
let fadeT  = 1;        // 0..1
let prevIdx = 0;

function ease(t){ return t*t*(3-2*t); }  // smoothstep


let zoom = 1;            // 1 = normal; >1 = bigger letters
let zoomSlider;          // UI control for now
let lastNumeric = null;  // when you send numbers from ESP32

// Firebase-driven controls
let latest = 0;                // 0..1 from partner’s board
let points = [];               // optional rolling history (for future visuals)

// called by index.html module whenever a new value arrives
window.onFirebaseValue = ({ t, v }) => {
  latest = constrain(v, 0, 1);
  points.push({ t, v: latest });
  if (points.length > 600) points.shift();
};


// Sentiment model (ml5)
let sentimentModel = null;
let modelReady = false;

// Default text pool 
let defaultTexts = [
  "plant a garden",
  "What do you want to say?",
  "Type a thought",
  "Watch it Grow"
];


// Pools used by the text-mosaic (seed neutral with defaults)
let posLines = [];
let neuLines = defaultTexts.slice();
let negLines = [];
let posPtr = 0, neuPtr = 0, negPtr = 0;

// ---------- optional Wi-Fi path (comment out if not using yet) ----------
function connectWS() {
  ws = new WebSocket('ws://esp32.local:81/');
  ws.onmessage = (ev) => handleSerialLine(String(ev.data).trim());
}

// ---------- preload/setup/draw ----------
function preload() {
  const names = ["GardenMask_1.png","GardenMask_2.png","GardenMask_3.png","GardenMask_4.png"];
  masks = names.map(n => loadImage(n));
  console.log("loaded masks:", names.length);
}


function setup() {
  createCanvas(1000, 700);
  updateMask();
  frameRate(30);

  // ml5 sentiment
sentimentModel = ml5.sentiment('movieReviews', () => {
  modelReady = true;
  qs("#sentDebug").textContent = "ml5 sentiment: ready";
});

  // UI + layers
  setupUI();
  lightG = createGraphics(width, height);

  wordsG = createGraphics(width, height);
  wordsG.textAlign(CENTER, CENTER);
  wordsG.textFont('Courier New');

  // slider to blend the text mosaic on/off
  mixSlider = createSlider(0, 1, 0.8, 0.01);
  mixSlider.position(12, 48);
  
  zoomSlider = createSlider(0.6, 2.2, 1.0, 0.01);
zoomSlider.position(12, 72);
  
  revealSlider = createSlider(0, 1, 0.75, 0.01);
revealSlider.position(12, 96);

}


//---------------draw
function draw() {
  if (isPaused) return;
drawGardenBackground();
drawWordsMosaic();
tint(255, 255 * mixSlider.value()); image(wordsG, 0, 0); noTint();
drawHighlight();          

  text(`text mix: ${mixSlider.value().toFixed(2)}`, width/2, 40);
  
  zoom = zoomSlider.value();

// If ESP32 sends numbers later, let that override:
if (lastNumeric != null) {
  zoom = map(lastNumeric, 0, 4095, 0.8, 2.0, true);
}
  
  reveal = revealSlider.value();
if (lastNumeric != null) {
  reveal = map(lastNumeric, 0, 4095, 0.25, 1.0, true);  // bright room → more text visible
}
  
if (frameCount % 30 === 0) {  // every ~1s at 30fps
  bandOffset.pos++;
  bandOffset.neu++;
  bandOffset.neg++;
}


}
//-----------end of draw

function updateMask() {
  maskImg = masks[maskIdx % masks.length];
  if (!maskImg) return;
  maskImg.resize(width, height);
  maskImg.filter(GRAY);
}

function currentMask() {
  let img = masks[maskIdx];
  if (!img) return null;
  if (img.width !== width || img.height !== height) {
    img.resize(width, height);
    img.filter(GRAY);
  }
  return img;
}


function nextMask() {
  maskIdx = (maskIdx + 1) % masks.length;

  // small “reset” so the new image feels fresh
  bandOffset = { pos:0, neu:0, neg:0 };
  revealPulse = 1;              // brief brighten if you kept the pulse var
  // optionally clear highlight
  highlight.ttl = 0;
}

function readyMask(img){
  if (!img) return null;
  if (img.width !== width || img.height !== height) {
    img.resize(width, height);
    img.filter(GRAY);
  }
  return img;
}


function drawHighlight() {
  if (highlight.ttl <= 0 || !highlight.text) return;

  push();
  textAlign(CENTER, CENTER);
  noStroke();
  textFont('Courier New');

  const size = gridStep * 2.4 * max(1, zoom);
  const a = highlight.alpha;
// pick color by band
let col = [255, 240, 220];      // neutral = warm white
if (highlight.band === 'positive') col = [0,255,0];   // green
if (highlight.band === 'negative') col = [250, 128, 114];   // salmon

// halo
push(); blendMode(ADD);
fill(col[0], col[1], col[2], 32);
circle(highlight.x, highlight.y, size * 2.6);
pop();

// shadow + word
fill(0, 0, 0, a);
textSize(size);
text(highlight.text, highlight.x + 2, highlight.y + 2);

fill(col[0], col[1], col[2], a);
text(highlight.text, highlight.x, highlight.y);


  pop();

  highlight.alpha *= 0.93;
  highlight.ttl--;
}

function drawGardenBackground() {
  // vertical gradient dusk→night
  for (let y = 0; y < height; y++) {
    const r = lerpColor(color(9, 28, 32), color(22, 60, 66), y/height);
    stroke(r); line(0, y, width, y);
  }
}

// Tiny rule-based sentiment → color ----------------------------------------

function classify(t) {
  const raw = (t == null ? "" : String(t)).trim();
  const s = raw.toLowerCase();
  let bucket = "neutral";
  let scoreTxt = "n/a";

  if (modelReady && raw.length > 0) {
    let pred; try { pred = sentimentModel.predict(raw); } catch(_) {}
    const sc = (pred && typeof pred.score === "number") ? pred.score : null;
    if (sc != null && isFinite(sc)) {
      scoreTxt = sc.toFixed(2);
      if (sc > 0.70) bucket = "positive";
      else if (sc < 0.40) bucket = "negative";
      else bucket = "neutral";
    } else {
      if (s.includes("sad") || s.includes("tired") || s.includes("angry")) bucket = "negative";
      else if (s.includes("love") || s.includes("heart") || s.includes("kiss")) bucket = "positive";
    }
  } else {
    if (s.includes("sad") || s.includes("tired") || s.includes("angry")) bucket = "negative";
    else if (s.includes("love") || s.includes("heart") || s.includes("kiss")) bucket = "positive";
  }
}


//-------------------


function handleSerialLine(line) {
  if (!line) return;
  console.log("serial:", line);        

  const n = Number(line);
  if (!Number.isNaN(n)) { lastNumeric = n; return; }

  if (line === "NEXT") { nextMask(); return; }
  if (line === "PLANT") { pushLineBySentiment(currentTextOrDefault()); return; }
  if (line.startsWith("TEXT:")) {
    const t = line.slice(5).trim();
    if (t) pushLineBySentiment(t);
  }
}





// UI wiring -----------------------------------------------------------------
function setupUI() {
  qs("#pause").addEventListener("click", () => {
    isPaused = !isPaused;
    qs("#pause").textContent = isPaused ? "Play" : "Pause";
    if (!isPaused) redraw();
    
  });




 qs("#plant").addEventListener("click", () => {
  const t = currentTextOrDefault();
  pushLineBySentiment(t);   // <— this updates the pools used by the mosaic
  qs("#usertext").value = "";
});

  
  
async function connectSerial() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: BAUD });
    const textDecoder = new TextDecoderStream();
    port.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();
    qs("#status").textContent = "connected";
    readLoop();
  } catch (e) {
    console.error(e);
    qs("#status").textContent = "error";
  }
}

async function readLoop() {
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      buffer += value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (let line of lines) handleSerialLine(line.trim());

    }
  } catch (e) {
    console.error("serial read error", e);
    qs("#status").textContent = "read error";
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

  qs("#connect").addEventListener("click", () => {
  if (!("serial" in navigator)) {
    alert("Web Serial not supported. Use Chrome/Edge desktop over HTTPS/localhost.");
    return;
  }
  connectSerial();
});

}

function currentTextOrDefault() {
  const box = qs("#usertext");
  const txt = box.value.trim();
  if (txt) return txt;
  return defaultTexts[int(random(defaultTexts.length))];
}

function qs(sel) { return document.querySelector(sel); }


//---------------sentiment helpers

function pushLineBySentiment(textIn) {
  const line = (textIn || "").trim();
  if (!line) return;

  let band = "neutral";
  try {
    if (modelReady) {
      const { score } = sentimentModel.predict(line); // 0..1
      band = score > 0.70 ? "positive" : score < 0.40 ? "negative" : "neutral";
    } else {
      const tag = classify(line);
      band = (tag === "love" || tag === "positive") ? "positive"
           : (tag === "negative") ? "negative"
           : "neutral";
      
bandOffset[highlight.band === 'positive' ? 'pos' :
           highlight.band === 'negative' ? 'neg' : 'neu'] += 25; // small jump

    }
  } catch {}

  const pool = band === "positive" ? posLines : band === "negative" ? negLines : neuLines;

  const MAX_LINES = 80; // tune
  if (pool.length >= MAX_LINES) {
    const i = floor(random(pool.length));
    pool[i] = line;               // ← replace a random line
  } else {
    pool.push(line);
  }
const bandY = band === "positive" ? [height*0.20, height*0.38]
             : band === "negative" ? [height*0.78, height*0.92]
             : [height*0.50, height*0.68];

highlight.text  = line;
highlight.band  = band;
highlight.x     = random(width*0.15, width*0.85);
highlight.y     = random(bandY[0], bandY[1]);
highlight.alpha = 255;
highlight.ttl   = 120; // ~4s at 30fps


  try {
  const msg = modelReady
    ? `ml5 score=${sentimentModel.predict(line).score.toFixed(2)} → ${band}`
    : `(fallback classify) → ${band}`;
  qs("#sentDebug").textContent = msg;
} catch {}

}


//-----characters in image


// shared rolling pointers
let posLineIdx=0, posCharIdx=0;
let neuLineIdx=0, neuCharIdx=0;
let negLineIdx=0, negCharIdx=0;

function nextCharFrom(lines, state) {
  if (!lines.length) return " ";
  if (!lines[state.lineIdx]) state.lineIdx = 0;
  const line = lines[state.lineIdx] || " ";
  if (!line.length) {
    state.lineIdx = (state.lineIdx + 1) % lines.length;
    state.charIdx = 0;
    return " ";
  }
  const ch = line[state.charIdx];
  state.charIdx++;
  if (state.charIdx >= line.length) {
    state.charIdx = 0;
    state.lineIdx = (state.lineIdx + 1) % lines.length;
  }
  return ch;
}

function charForCell(yNorm, row, col) {
  let lines, key;
  if (yNorm < 0.40 && posLines.length) { lines = posLines; key = 'pos'; }
  else if (yNorm > 0.70 && negLines.length) { lines = negLines; key = 'neg'; }
  else { lines = neuLines; key = 'neu'; }

  // Concatenate pool into one long string (cacheable later if needed)
  const s = lines.join("  ");   // add spaces between lines
  if (!s.length) return " ";

  // Map grid cell to char index, add a slow offset
  const cols = Math.floor(width / gridStep);
  const idx = (row * cols + col + bandOffset[key]) % s.length;
  return s.charAt(idx);
}




//------end char control



function drawWordsMosaic() {
  const curr = readyMask(masks[maskIdx]);
  if (!curr) return;

  const prev = fading ? readyMask(masks[prevIdx]) : null;

  wordsG.clear();
  wordsG.fill(240);
  wordsG.noStroke();
  wordsG.textAlign(CENTER, CENTER);

  for (let y = 0, row = 0; y < height; y += gridStep, row++) {
    for (let x = 0, col = 0; x < width; x += gridStep, col++) {

      // blended brightness: lerp(prev→curr) with easing
      let b = brightness(curr.get(x, y));
      if (prev) {
        const bp = brightness(prev.get(x, y));
        b = lerp(bp, b, ease(fadeT));
      }

      if (b > maskCutoff) {
        // reveal gate (keep your reveal logic)
        const gate = noise(x*0.03, y*0.03, 7.77);
        if (gate > reveal) continue;

        const ch = charForCell(y/height, row, col);
        wordsG.textSize(gridStep * 0.92 * zoom);
        wordsG.text(ch, x, y);
      }
    }
  }

  // advance fade
  if (fading) {
    fadeT = min(1, fadeT + 0.04);   // ~25 frames ≈ 0.8s
    if (fadeT >= 1) fading = false;
  }
}
