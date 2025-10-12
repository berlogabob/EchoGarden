// ESP32: Удержание кнопки — LED горит, два тона на пассивном buzzer'е + нормализованная освещённость (0-1) каждую секунду
// Пины: Кнопка=16, LED=5, Buzzer=21, Фоторезистор=34

#define BUTTON_PIN 16
#define LED_PIN 5
#define BUZZER_PIN 21
#define PHOTO_PIN 34  // Аналоговый вход для фоторезистора
#define DEBOUNCE_DELAY 50    // мс для debounce
#define BEEP_FREQ_LOW 1000   // Гц для тона (подгони)
#define BEEP_FREQ_HIGH 2000  // Гц для тона (подгони)
#define BEEP_DURATION 200    // мс для писка
#define AVERAGE_INTERVAL 1000  // мс для усреднения (1 секунда)
#define ADC_MAX 4095.0       // Максимум ESP32 ADC для нормализации

bool lastButtonState = HIGH;  // Начально не нажата (с pull-up)
bool buttonPressed = false;   // Флаг для первого нажатия
unsigned long lastDebounceTime = 0;
unsigned long lastAverageTime = 0;  // Таймер для усреднения
long lightSum = 0;                // Сумма значений света (raw ADC)
int lightCount = 0;               // Кол-во сэмплов

void setup() {
  Serial.begin(115200);
  
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // Внутренний pull-up
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);        // Для tone()
  pinMode(PHOTO_PIN, INPUT);          // Аналоговый для фоторезистора
  
  digitalWrite(LED_PIN, LOW);
  
  Serial.println("Готово! Нажми и держи кнопку для LED + писк + нормализованная освещённость (0-1).");
}

// Функция нормализации: raw ADC (0-4095) -> 0.0-1.0 (0=темнота)
float normalizeLight(int rawLevel) {
  return (float)rawLevel / ADC_MAX;
}

void loop() {
  int reading = digitalRead(BUTTON_PIN);
  
  // Debounce
  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }
  
  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY) {
    if (reading == LOW) {  // Нажата
      digitalWrite(LED_PIN, HIGH);  // LED горит
      
      if (!buttonPressed) {         // Только при первом нажатии
        buttonPressed = true;
        lastAverageTime = millis(); // Старт таймера усреднения
        lightSum = 0;
        lightCount = 0;
        
        // Мгновенное чтение + нормализация
        int lightLevel = analogRead(PHOTO_PIN);
        float normalized = normalizeLight(lightLevel);
        Serial.print("Кнопка нажата: LED ON + Писк! Мгновенная освещённость (0-1): ");
        Serial.println(normalized, 3);  // 3 знака после запятой
        
        tone(BUZZER_PIN, BEEP_FREQ_LOW, BEEP_DURATION);
        tone(BUZZER_PIN, BEEP_FREQ_HIGH, BEEP_DURATION);  // Короткий писк
        noTone(BUZZER_PIN);  // Стоп после тонов (для чистоты)
      }
      
      // Усреднённое чтение каждую секунду (пока удерживается)
      unsigned long now = millis();
      if (now - lastAverageTime >= AVERAGE_INTERVAL) {
        // Добавляем текущее чтение перед расчётом
        lightSum += analogRead(PHOTO_PIN);
        lightCount++;
        
        if (lightCount > 0) {
          int averageRaw = lightSum / lightCount;
          float averageNormalized = normalizeLight(averageRaw);
          Serial.print("Освещённость (усреднённая за секунду, 0-1): ");
          Serial.println(averageNormalized, 3);  // 3 знака после запятой
        }
        
        // Сброс для следующей секунды
        lightSum = 0;
        lightCount = 0;
        lastAverageTime = now;
      } else {
        // Накапливаем сэмплы во время секунды (каждый loop)
        lightSum += analogRead(PHOTO_PIN);
        lightCount++;
      }
      
    } else {  // Отпущена
      if (buttonPressed) {  // Только если была нажата
        digitalWrite(LED_PIN, LOW);   // LED гаснет
        buttonPressed = false;
        Serial.println("Кнопка отпущена: LED OFF");
        
        // Сброс усреднения при отпускании
        lightSum = 0;
        lightCount = 0;
      }
    }
  }
  
  lastButtonState = reading;
  
  delay(10);  // Маленькая пауза для стабильности
}
