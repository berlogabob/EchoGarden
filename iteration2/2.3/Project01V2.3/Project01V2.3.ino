// ESP32: Button hold - LED lights up, two tones on passive buzzer + normalized illuminance (0-1) to Firebase
// Pins: Button=16, LED=5, Buzzer=21, Photoresistor=34

#include <WiFi.h>
#include "Firebase_ESP_Client.h"

// WiFi config
#define WIFI_SSID "Nothing32"
#define WIFI_PASSWORD "212855625"

// Firebase config
#define FIREBASE_HOST "echo2-a4581-default-rtdb.europe-west1.firebasedatabase.app"
#define API_KEY "AIzaSyDR3wpy57nlAVxbMqgjJOhmqPwnGuLwGe8"
//pins
#define BUTTON_PIN 16
#define LED_PIN 5
#define BUZZER_PIN 21
#define PHOTO_PIN 34  // Analog input for photoresistor
//additional stuff
#define DEBOUNCE_DELAY 50    // ms for debounce
#define BEEP_FREQ_LOW 1000   // Hz for tone (low)
#define BEEP_FREQ_HIGH 2000  // Hz for tone (high)
#define BEEP_DURATION 200    // ms for beep
#define AVERAGE_INTERVAL 1000  // ms for averaging (1 second)
#define ADC_MAX 4095.0       // ESP32 ADC maximum for normalization

bool lastButtonState = HIGH;  // Initially not pressed (with pull-up)
bool buttonPressed = false;   // Flag for first press
unsigned long lastDebounceTime = 0;
unsigned long lastAverageTime = 0;  // Timer for averaging
long lightSum = 0;                // Sum of light values (raw ADC)
int lightCount = 0;               // Number of samples

// Firebase objects
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

void setup() {
  Serial.begin(115200);
  
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // Internal pull-up
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);        // For tone()
  pinMode(PHOTO_PIN, INPUT);          // Analog for photoresistor
  
  digitalWrite(LED_PIN, LOW);
  
  // WiFi connection
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(300);
  }
  Serial.println();
  Serial.print("WiFi connected! IP: ");
  Serial.println(WiFi.localIP());
  
  // Firebase init for anonymous auth
  config.api_key = API_KEY;
  config.database_url = "https://" + String(FIREBASE_HOST) + "/";
  auth.user.email = "andre.berloga@gmail.com";  // Empty for anonymous
  auth.user.password = "212855625";
  
  Firebase.begin(&config, &auth);  // Init (handles anonymous if enabled)
  Firebase.reconnectWiFi(true);
  
  // Wait for token generation (anonymous needs time)
  delay(5000);  // 5 sec delay for auth/token
  
  // Debug after init
  Serial.println("Firebase init: Called (anonymous auth)");
  if (Firebase.ready()) {
    Serial.println("Firebase ready: YES");
  } else {
    Serial.println("Firebase ready: NO (check network/auth)");
    Serial.print("Last error: ");
    Serial.println(fbdo.errorReason());
  }
  
  Serial.println("Ready! Press and hold button for LED + beeps + illuminance to Firebase.");
}

// Normalization function: raw ADC (0-4095) -> 0.0-1.0 (0=darkness)
float normalizeLight(int rawLevel) {
  return (float)rawLevel / ADC_MAX;
}

// Firebase logging function
void logToFirebase(unsigned long timestamp, float value) {
  Serial.print("Attempting Firebase write... Ready? ");
  Serial.println(Firebase.ready() ? "YES" : "NO");
  
  if (Firebase.ready()) {
    String path = "/illuminance/" + String(timestamp);
    if (Firebase.RTDB.setFloat(&fbdo, path.c_str(), value)) {
      Serial.println("Firebase write: OK");
    } else {
      Serial.print("Firebase write error: ");
      Serial.println(fbdo.errorReason());
    }
  } else {
    Serial.println("Firebase not ready - skipping write");
  }
}

void loop() {
  int reading = digitalRead(BUTTON_PIN);
  
  // Debounce
  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }
  
  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
    if (reading == LOW) {  // Pressed
      digitalWrite(LED_PIN, HIGH);  // LED lights up
      
      if (!buttonPressed) {         // Only on first press
        buttonPressed = true;
        lastAverageTime = millis(); // Start averaging timer
        lightSum = 0;
        lightCount = 0;
        
        // Instant reading + normalization
        int lightLevel = analogRead(PHOTO_PIN);
        float normalized = normalizeLight(lightLevel);
        Serial.print("Button pressed: LED ON + Beeps! Instant illuminance (0-1): ");
        Serial.println(normalized, 3);  // 3 decimal places
        
        // Two tones on press
        tone(BUZZER_PIN, BEEP_FREQ_LOW, BEEP_DURATION);
        delay(BEEP_DURATION + 50);  // Wait + pause between tones
        tone(BUZZER_PIN, BEEP_FREQ_HIGH, BEEP_DURATION);
        noTone(BUZZER_PIN);  // Stop after tones
      }
      
      // Averaged reading every second (while held)
      unsigned long now = millis();
      if (now - lastAverageTime >= AVERAGE_INTERVAL) {
        // Add current reading before calculation
        lightSum += analogRead(PHOTO_PIN);
        lightCount++;
        
        if (lightCount > 0) {
          int averageRaw = lightSum / lightCount;
          float averageNormalized = normalizeLight(averageRaw);
          Serial.print("Illuminance (averaged over second, 0-1): ");
          Serial.println(averageNormalized, 3);  // 3 decimal places
          
          // Write to Firebase (timestamp = millis())
          logToFirebase(now, averageNormalized);
        }
        
        // Reset for next second
        lightSum = 0;
        lightCount = 0;
        lastAverageTime = now;
      } else {
        // Accumulate samples during the second (every loop)
        lightSum += analogRead(PHOTO_PIN);
        lightCount++;
      }
      
    } else {  // Released
      if (buttonPressed) {  // Only if it was pressed
        digitalWrite(LED_PIN, LOW);   // LED off
        buttonPressed = false;
        Serial.println("Button released: LED OFF");
        
        // Reset averaging on release
        lightSum = 0;
        lightCount = 0;
      }
    }
  }
  
  lastButtonState = reading;
  
  delay(10);  // Small pause for stability
}