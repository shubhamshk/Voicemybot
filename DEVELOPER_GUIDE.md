# 🔧 Developer Guide - Adding Custom TTS Providers

## Overview

This guide shows how to extend Janitor Voice with custom TTS providers like ElevenLabs, PlayHT, or Azure TTS.

---

## Architecture

The extension uses an **abstract TTS engine interface** that allows different implementations:

```
TTSEngine (Abstract Base Class)
├── WebSpeechTTS (Current - Web Speech API)
├── ElevenLabsTTS (Future - Premium voices)
├── PlayHTTTS (Future - Commercial TTS)
└── AzureTTS (Future - Microsoft Azure)
```

---

## Step 1: Understand the Interface

Every TTS provider must implement the `TTSEngine` abstract class:

```javascript
class TTSEngine {
  async initialize() { }      // Setup and authenticate
  async speak(text, options) { }  // Speak text
  stop() { }                  // Stop current speech
  pause() { }                 // Pause speech
  resume() { }                // Resume speech
  isSpeaking() { }            // Check if speaking
  getVoices() { }             // Get available voices
}
```

---

## Step 2: Create Your Provider Class

### Example: ElevenLabs TTS

```javascript
/**
 * ElevenLabs TTS Implementation
 */
class ElevenLabsTTS extends TTSEngine {
  constructor(apiKey) {
    super();
    this.apiKey = apiKey;
    this.baseURL = 'https://api.elevenlabs.io/v1';
    this.voices = [];
    this.currentAudio = null;
    this.queue = [];
    this.isProcessingQueue = false;
  }
  
  /**
   * Initialize and load voices
   */
  async initialize() {
    try {
      // Fetch available voices from ElevenLabs
      const response = await fetch(`${this.baseURL}/voices`, {
        headers: {
          'xi-api-key': this.apiKey
        }
      });
      
      const data = await response.json();
      this.voices = data.voices || [];
      
      console.log('[ElevenLabs] Loaded', this.voices.length, 'voices');
      return true;
    } catch (error) {
      console.error('[ElevenLabs] Init error:', error);
      return false;
    }
  }
  
  /**
   * Speak text using ElevenLabs API
   */
  async speak(text, options = {}) {
    if (!text || text.trim().length === 0) {
      return;
    }
    
    // Add to queue
    this.queue.push({ text, options });
    
    // Process queue
    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }
  
  /**
   * Process speech queue
   */
  async processQueue() {
    if (this.queue.length === 0) {
      this.isProcessingQueue = false;
      return;
    }
    
    this.isProcessingQueue = true;
    const { text, options } = this.queue.shift();
    
    await this.speakSingle(text, options);
    
    // Delay before next
    setTimeout(() => {
      this.processQueue();
    }, 500);
  }
  
  /**
   * Speak a single utterance
   */
  async speakSingle(text, options) {
    try {
      // Get voice ID
      const voiceId = options.voiceURI || this.voices[0]?.voice_id;
      
      if (!voiceId) {
        throw new Error('No voice selected');
      }
      
      // Request speech from ElevenLabs
      const response = await fetch(
        `${this.baseURL}/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'Accept': 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey
          },
          body: JSON.stringify({
            text: text,
            model_id: 'eleven_monolingual_v1',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.5
            }
          })
        }
      );
      
      if (!response.ok) {
        throw new Error('ElevenLabs API error: ' + response.status);
      }
      
      // Get audio blob
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Play audio
      return new Promise((resolve, reject) => {
        this.currentAudio = new Audio(audioUrl);
        this.currentAudio.volume = options.volume || 1.0;
        
        this.currentAudio.onended = () => {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          resolve();
        };
        
        this.currentAudio.onerror = (error) => {
          URL.revokeObjectURL(audioUrl);
          this.currentAudio = null;
          reject(error);
        };
        
        this.currentAudio.play();
      });
      
    } catch (error) {
      console.error('[ElevenLabs] Speak error:', error);
      throw error;
    }
  }
  
  /**
   * Stop all speech
   */
  stop() {
    this.queue = [];
    this.isProcessingQueue = false;
    
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
  }
  
  /**
   * Pause current speech
   */
  pause() {
    if (this.currentAudio && !this.currentAudio.paused) {
      this.currentAudio.pause();
    }
  }
  
  /**
   * Resume paused speech
   */
  resume() {
    if (this.currentAudio && this.currentAudio.paused) {
      this.currentAudio.play();
    }
  }
  
  /**
   * Check if speaking
   */
  isSpeaking() {
    return this.currentAudio && !this.currentAudio.paused;
  }
  
  /**
   * Get available voices
   */
  getVoices() {
    return this.voices.map(voice => ({
      voiceURI: voice.voice_id,
      name: voice.name,
      lang: voice.labels?.language || 'en'
    }));
  }
}
```

---

## Step 3: Update VoiceController

Modify the `VoiceController` constructor to use your new engine:

```javascript
class VoiceController {
  constructor() {
    // Get API key from settings (see Step 4)
    const apiKey = StorageManager.get('elevenlabs_api_key', null);
    
    // Choose engine based on availability
    if (apiKey) {
      this.ttsEngine = new ElevenLabsTTS(apiKey);
      console.log('[Janitor Voice] Using ElevenLabs TTS');
    } else {
      this.ttsEngine = new WebSpeechTTS();
      console.log('[Janitor Voice] Using Web Speech API');
    }
    
    this.messageDetector = null;
    this.uiPanel = null;
    this.settings = CONFIG.DEFAULTS;
    this.isInitialized = false;
  }
  
  // ... rest of the class
}
```

---

## Step 4: Add API Key Configuration UI

Add an API key input to the UI panel:

### Update UIPanel.create()

```javascript
create() {
  this.panel.innerHTML = `
    <div class="jv-header" id="jv-drag-handle">
      <!-- ... existing header ... -->
    </div>
    <div class="jv-body" id="jv-body">
      
      <!-- NEW: API Key Section -->
      <div class="jv-section">
        <div class="jv-section-title">TTS Provider</div>
        
        <div class="jv-control">
          <label class="jv-label">Provider</label>
          <select id="jv-provider" class="jv-select">
            <option value="web-speech">Web Speech API (Free)</option>
            <option value="elevenlabs">ElevenLabs (Premium)</option>
          </select>
        </div>
        
        <div class="jv-control" id="jv-api-key-control" style="display: none;">
          <label class="jv-label">API Key</label>
          <input 
            type="password" 
            id="jv-api-key" 
            class="jv-input" 
            placeholder="Enter ElevenLabs API key"
          />
          <button class="jv-btn-save" id="jv-save-key">Save</button>
        </div>
      </div>
      
      <!-- Existing controls -->
      <div class="jv-control">
        <!-- ... toggle ... -->
      </div>
      
      <!-- ... rest of controls ... -->
    </div>
  `;
  
  // ... existing code ...
}
```

### Add Event Listener

```javascript
setupEventListeners() {
  // ... existing listeners ...
  
  // Provider selector
  const provider = this.panel.querySelector('#jv-provider');
  const apiKeyControl = this.panel.querySelector('#jv-api-key-control');
  
  provider.addEventListener('change', (e) => {
    if (e.target.value === 'elevenlabs') {
      apiKeyControl.style.display = 'flex';
    } else {
      apiKeyControl.style.display = 'none';
    }
  });
  
  // Save API key
  const saveKeyBtn = this.panel.querySelector('#jv-save-key');
  saveKeyBtn.addEventListener('click', () => {
    const apiKey = this.panel.querySelector('#jv-api-key').value;
    if (apiKey) {
      StorageManager.set('elevenlabs_api_key', apiKey);
      this.controller.switchProvider('elevenlabs', apiKey);
      this.updateStatus('✓ API Key Saved');
    }
  });
}
```

---

## Step 5: Add Provider Switching

Add method to `VoiceController`:

```javascript
/**
 * Switch TTS provider
 */
async switchProvider(providerType, apiKey = null) {
  // Stop current engine
  if (this.ttsEngine) {
    this.ttsEngine.stop();
  }
  
  // Create new engine
  switch (providerType) {
    case 'elevenlabs':
      this.ttsEngine = new ElevenLabsTTS(apiKey);
      break;
    case 'playht':
      this.ttsEngine = new PlayHTTTS(apiKey);
      break;
    case 'azure':
      this.ttsEngine = new AzureTTS(apiKey);
      break;
    default:
      this.ttsEngine = new WebSpeechTTS();
  }
  
  // Initialize new engine
  await this.ttsEngine.initialize();
  
  // Update UI
  if (this.uiPanel) {
    this.uiPanel.populateVoices();
  }
  
  console.log('[Janitor Voice] Switched to', providerType);
}
```

---

## Step 6: Security Best Practices

### Never Hardcode API Keys

❌ **WRONG:**
```javascript
const apiKey = 'sk-1234567890abcdef'; // DON'T DO THIS!
```

✅ **CORRECT:**
```javascript
const apiKey = StorageManager.get('elevenlabs_api_key', null);
if (!apiKey) {
  console.error('API key not configured');
  return;
}
```

### Use Chrome Storage API for Sensitive Data

For production, use `chrome.storage.local` instead of `localStorage`:

```javascript
// Save API key
chrome.storage.local.set({ 'elevenlabs_api_key': apiKey });

// Get API key
chrome.storage.local.get(['elevenlabs_api_key'], (result) => {
  const apiKey = result.elevenlabs_api_key;
});
```

### Add API Key Validation

```javascript
async validateAPIKey(apiKey) {
  try {
    const response = await fetch(`${this.baseURL}/voices`, {
      headers: { 'xi-api-key': apiKey }
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}
```

---

## Step 7: Update Styles

Add styles for new UI elements:

```css
/* API Key Input */
.jv-input {
  width: 100%;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  outline: none;
  font-family: 'Courier New', monospace;
}

.jv-input:focus {
  background: rgba(255, 255, 255, 0.1);
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.jv-btn-save {
  margin-top: 8px;
  padding: 8px 16px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.jv-btn-save:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.jv-section {
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.jv-section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 12px;
  letter-spacing: 0.5px;
}
```

---

## Complete Example: PlayHT Integration

```javascript
class PlayHTTTS extends TTSEngine {
  constructor(apiKey, userId) {
    super();
    this.apiKey = apiKey;
    this.userId = userId;
    this.baseURL = 'https://play.ht/api/v2';
    this.voices = [];
  }
  
  async initialize() {
    // Fetch voices
    const response = await fetch(`${this.baseURL}/voices`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'X-User-Id': this.userId
      }
    });
    
    this.voices = await response.json();
    return true;
  }
  
  async speak(text, options = {}) {
    // Generate speech
    const response = await fetch(`${this.baseURL}/tts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'X-User-Id': this.userId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: text,
        voice: options.voiceURI || this.voices[0].id,
        speed: options.rate || 1.0,
        sample_rate: 24000,
        output_format: 'mp3'
      })
    });
    
    const data = await response.json();
    
    // Play audio
    const audio = new Audio(data.audioUrl);
    await audio.play();
  }
  
  // ... implement other required methods
}
```

---

## Testing Your Provider

1. **Add your provider class** to `content.js`
2. **Update VoiceController** to use it
3. **Reload extension** in Chrome
4. **Test on Janitor AI**:
   - Check if voices load correctly
   - Test speech generation
   - Verify queue handling
   - Check error handling

5. **Monitor console** for errors:
```javascript
[Janitor Voice] Using ElevenLabs TTS
[ElevenLabs] Loaded 29 voices
[ElevenLabs] Speaking: "Hello, how are you?"
```

---

## Error Handling

Always add robust error handling:

```javascript
async speak(text, options = {}) {
  try {
    await this.generateSpeech(text, options);
  } catch (error) {
    console.error('[Provider] Speech error:', error);
    
    // Fallback to Web Speech API
    const fallback = new WebSpeechTTS();
    await fallback.initialize();
    await fallback.speak(text, options);
  }
}
```

---

## Performance Optimization

### Caching

```javascript
class CachedTTS extends TTSEngine {
  constructor(baseEngine) {
    super();
    this.baseEngine = baseEngine;
    this.cache = new Map();
  }
  
  async speak(text, options = {}) {
    const cacheKey = `${text}_${JSON.stringify(options)}`;
    
    if (this.cache.has(cacheKey)) {
      const audioUrl = this.cache.get(cacheKey);
      await this.playAudio(audioUrl);
    } else {
      const audioUrl = await this.baseEngine.speak(text, options);
      this.cache.set(cacheKey, audioUrl);
    }
  }
}
```

---

## Resources

- **ElevenLabs API**: https://docs.elevenlabs.io/
- **PlayHT API**: https://docs.play.ht/
- **Azure TTS**: https://docs.microsoft.com/en-us/azure/cognitive-services/speech-service/
- **Chrome Extension APIs**: https://developer.chrome.com/docs/extensions/

---

**Happy Coding! 🚀**
