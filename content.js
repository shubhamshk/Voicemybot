/**
 * Janitor Voice - Content Script
 * Production-quality Text-to-Speech for Janitor AI
 * 
 * Architecture:
 * - TTSEngine: Abstract interface for TTS providers
 * - WebSpeechTTS: Web Speech API implementation
 * - MessageDetector: MutationObserver-based message detection
 * - VoiceController: Main orchestrator
 * - UIPanel: Draggable control panel
 * - OverlayManager: Manages the floating overlay for buttons
 * - HighlightManager: Handles real-time text highlighting
 */

'use strict';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const CONFIG = {
  STORAGE_PREFIX: 'janitor_voice_',
  PROVIDERS: {
    WEB: 'web_speech',
    ELEVEN: 'eleven_labs',
    UNREAL: 'unreal_speech'
  },
  DEFAULTS: {
    enabled: true,
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
    voiceURI: null,
    provider: 'web_speech',
    elevenLabsKey: '',
    unrealKey: ''
  },
  SELECTORS: {
    chatContainer: '[data-testid="virtuoso-scroller"], [data-testid="virtuoso-item-list"], main',
    characterMessage: 'li._messageDisplayWrapper_2xqwb_2, li[class*="_messageDisplayWrapper_"]',
    userMessage: '[class*="user"]',
    messageBody: '[class*="_messageBody_"]'
  },
  UI: {
    panelId: 'janitor-voice-panel',
    overlayId: 'janitor-voice-overlay'
  }
};

const StorageManager = {
  get(key, defaultValue = null) {
    try {
      const stored = localStorage.getItem(CONFIG.STORAGE_PREFIX + key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch (error) {
      console.error('[Janitor Voice] Storage get error:', error);
      return defaultValue;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(CONFIG.STORAGE_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error('[Janitor Voice] Storage set error:', error);
      return false;
    }
  },
  loadSettings() {
    return {
      enabled: this.get('enabled', CONFIG.DEFAULTS.enabled),
      rate: this.get('rate', CONFIG.DEFAULTS.rate),
      pitch: this.get('pitch', CONFIG.DEFAULTS.pitch),
      volume: this.get('volume', CONFIG.DEFAULTS.volume),
      voiceURI: this.get('voiceURI', CONFIG.DEFAULTS.voiceURI),
      provider: this.get('provider', CONFIG.DEFAULTS.provider),
      elevenLabsKey: this.get('elevenLabsKey', CONFIG.DEFAULTS.elevenLabsKey),
      unrealKey: this.get('unrealKey', CONFIG.DEFAULTS.unrealKey)
    };
  }
};

// ============================================================================
// TEXT CHUNKING UTILITY
// ============================================================================

/**
 * Smart text splitter that respects sentence boundaries
 * Splits text into chunks <= maxLength, preferring sentence endings
 * @param {string} text - Text to split
 * @param {number} maxLength - Maximum chunk length (default 900)
 * @returns {string[]} Array of text chunks
 */
function smartSplit(text, maxLength = 900) {
  if (!text || text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find the best split point within maxLength
    let chunk = remaining.substring(0, maxLength);
    let splitIndex = -1;

    // Try to split at sentence boundary (. ! ?)
    const sentenceMatch = chunk.match(/[.!?]\s+(?=[A-Z])/g);
    if (sentenceMatch) {
      const lastSentence = chunk.lastIndexOf(sentenceMatch[sentenceMatch.length - 1]);
      if (lastSentence > maxLength * 0.5) { // Don't split too early
        splitIndex = lastSentence + sentenceMatch[sentenceMatch.length - 1].length;
      }
    }

    // If no sentence boundary, try paragraph break
    if (splitIndex === -1) {
      splitIndex = chunk.lastIndexOf('\n\n');
      if (splitIndex < maxLength * 0.5) splitIndex = -1;
    }

    // If no paragraph, try single newline
    if (splitIndex === -1) {
      splitIndex = chunk.lastIndexOf('\n');
      if (splitIndex < maxLength * 0.5) splitIndex = -1;
    }

    // If no newline, try comma or semicolon
    if (splitIndex === -1) {
      const punctMatch = chunk.match(/[,;]\s/g);
      if (punctMatch) {
        const lastPunct = chunk.lastIndexOf(punctMatch[punctMatch.length - 1]);
        if (lastPunct > maxLength * 0.5) {
          splitIndex = lastPunct + punctMatch[punctMatch.length - 1].length;
        }
      }
    }

    // Last resort: split at last space
    if (splitIndex === -1) {
      splitIndex = chunk.lastIndexOf(' ');
      if (splitIndex === -1) splitIndex = maxLength; // Force split if no space
    }

    chunks.push(remaining.substring(0, splitIndex).trim());
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks.filter(c => c.length > 0);
}

// ============================================================================
// TTS ENGINE
// ============================================================================

class WebSpeechTTS {
  constructor() {
    this.synth = window.speechSynthesis;
    this.voices = [];
    this.currentUtterance = null;
  }
  async initialize() {
    return new Promise((resolve) => {
      const load = () => {
        this.voices = this.synth.getVoices();
        if (this.voices.length > 0) resolve(true);
      };
      load();
      if (this.voices.length === 0) {
        this.synth.onvoiceschanged = load;
        setTimeout(() => resolve(true), 1000); // Fallback
      }
    });
  }

  // Updated speak method with onBoundary support
  speak(text, options = {}, onEnd, onBoundary, onProgress) {
    this.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate || 1.0;
    utterance.pitch = options.pitch || 1.0;
    utterance.volume = options.volume || 1.0;
    if (options.voiceURI) {
      const voice = this.voices.find(v => v.voiceURI === options.voiceURI);
      if (voice) utterance.voice = voice;
    }

    this.currentUtterance = utterance;

    utterance.onend = () => {
      if (this.currentUtterance === utterance) {
        this.currentUtterance = null;
      }
      if (onEnd) onEnd();
    };

    utterance.onerror = (e) => {
      console.error('[Janitor Voice] Speech error', e);
      if (onEnd) onEnd();
    };

    if (onBoundary) {
      utterance.onboundary = onBoundary;
    }

    this.synth.speak(utterance);
  }

  cancel() {
    this.synth.cancel();
    this.currentUtterance = null;
  }

  pause() { this.synth.pause(); }
  resume() { this.synth.resume(); }
  isSpeaking() { return this.synth.speaking; }
  getVoices() { return this.voices; }
}

class ElevenLabsTTS {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.voices = [];
    this.apiKey = null;
    this.currentSource = null;
  }

  setApiKey(key) {
    this.apiKey = key;
    if (key) this.fetchVoices();
  }

  async fetchVoices() {
    if (!this.apiKey) return;
    try {
      const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': this.apiKey }
      });
      const data = await resp.json();
      if (data.voices) {
        this.voices = data.voices.map(v => ({
          name: v.name,
          voiceURI: v.voice_id,
          lang: 'en-US', // ElevenLabs is mostly English focused for basics
          provider: 'eleven_labs'
        }));
      }
    } catch (e) {
      console.error('[Janitor Voice] EL Voices Error:', e);
    }
  }

  async speak(text, options, onEnd, onProgress) {
    this.cancel();
    if (!this.apiKey) {
      console.warn('[Janitor Voice] No ElevenLabs API Key');
      if (onEnd) onEnd();
      return;
    }

    try {
      // Split text into chunks if needed
      const chunks = smartSplit(text, 900);
      const totalChunks = chunks.length;

      console.log(`[Janitor Voice] ElevenLabs: Processing ${totalChunks} chunk(s)`);

      // Process chunks sequentially
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkNum = i + 1;

        // Update progress
        if (onProgress && totalChunks > 1) {
          onProgress(`Generating voice (${chunkNum}/${totalChunks})...`);
        }

        const voiceId = options.voiceURI || (this.voices[0] ? this.voices[0].voiceURI : '21m00Tcm4TlvDq8ikWAM');
        const modelId = 'eleven_turbo_v2_5';

        console.log(`[Janitor Voice] ElevenLabs: Generating chunk ${chunkNum}/${totalChunks}, length: ${chunk.length}`);

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.apiKey
          },
          body: JSON.stringify({
            text: chunk,
            model_id: modelId,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75
            }
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Janitor Voice] ElevenLabs API Error:', {
            status: response.status,
            statusText: response.statusText,
            error: errorText
          });
          throw new Error(`ElevenLabs API Error (${response.status}): ${errorText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        console.log(`[Janitor Voice] ElevenLabs: Chunk ${chunkNum} audio received, size:`, arrayBuffer.byteLength);

        // Update progress
        if (onProgress && totalChunks > 1) {
          onProgress(`Playing (${chunkNum}/${totalChunks})...`);
        }

        // Decode and play audio
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        // Play this chunk and wait for it to finish
        await new Promise((resolve, reject) => {
          this.currentSource = this.audioContext.createBufferSource();
          this.currentSource.buffer = audioBuffer;
          this.currentSource.playbackRate.value = options.rate || 1.0;
          this.currentSource.connect(this.audioContext.destination);

          this.currentSource.onended = () => {
            this.currentSource = null;
            resolve();
          };

          this.currentSource.onerror = (e) => {
            console.error('[Janitor Voice] Audio playback error:', e);
            reject(e);
          };

          this.currentSource.start(0);
          console.log(`[Janitor Voice] ElevenLabs: Playing chunk ${chunkNum}/${totalChunks}`);
        });
      }

      console.log('[Janitor Voice] ElevenLabs: All chunks completed');
      if (onEnd) onEnd();

    } catch (e) {
      console.error('[Janitor Voice] ElevenLabs Speak Error:', e);
      alert(`ElevenLabs Error: ${e.message}. Check console for details.`);
      if (onEnd) onEnd();
    }
  }

  cancel() {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {
        // Source may have already ended
      }
      this.currentSource = null;
    }
  }

  getVoices() { return this.voices; }
}

class UnrealSpeechTTS {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.apiKey = null;
    this.currentSource = null;
    // Hardcoded voices as Unreal Speech has a fixed set
    this.voices = [
      { name: 'Will (Male)', voiceURI: 'Will', provider: 'unreal_speech' },
      { name: 'Scarlett (Female)', voiceURI: 'Scarlett', provider: 'unreal_speech' },
      { name: 'Liv (Female)', voiceURI: 'Liv', provider: 'unreal_speech' },
      { name: 'Amy (Female)', voiceURI: 'Amy', provider: 'unreal_speech' },
      { name: 'Dan (Male)', voiceURI: 'Dan', provider: 'unreal_speech' }
    ];
  }

  setApiKey(key) { this.apiKey = key; }

  async speak(text, options, onEnd, onProgress) {
    this.cancel();
    if (!this.apiKey) {
      console.warn('[Janitor Voice] No Unreal Speech API Key');
      if (onEnd) onEnd();
      return;
    }

    try {
      // Split text into chunks if needed
      const chunks = smartSplit(text, 900);
      const totalChunks = chunks.length;

      console.log(`[Janitor Voice] Unreal Speech: Processing ${totalChunks} chunk(s)`);

      // Process chunks sequentially
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkNum = i + 1;

        // Update progress
        if (onProgress && totalChunks > 1) {
          onProgress(`Generating voice (${chunkNum}/${totalChunks})...`);
        }

        const voiceId = options.voiceURI || 'Scarlett';

        console.log(`[Janitor Voice] Unreal Speech: Generating chunk ${chunkNum}/${totalChunks}, length: ${chunk.length}`);

        const response = await fetch('https://api.v6.unrealspeech.com/stream', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            Text: chunk,
            VoiceId: voiceId,
            Bitrate: '192k',
            Speed: '0',
            Pitch: '1.0',
            Codec: 'libmp3lame'
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[Janitor Voice] Unreal Speech API Error:', {
            status: response.status,
            statusText: response.statusText,
            error: errorText
          });
          throw new Error(`Unreal Speech API Error (${response.status}): ${errorText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        console.log(`[Janitor Voice] Unreal Speech: Chunk ${chunkNum} audio received, size:`, arrayBuffer.byteLength);

        // Validate
        if (arrayBuffer.byteLength === 0) {
          throw new Error('Unreal Speech returned empty audio response');
        }

        // Update progress
        if (onProgress && totalChunks > 1) {
          onProgress(`Playing (${chunkNum}/${totalChunks})...`);
        }

        // Decode and play audio
        const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        // Play this chunk and wait for it to finish
        await new Promise((resolve, reject) => {
          this.currentSource = this.audioContext.createBufferSource();
          this.currentSource.buffer = audioBuffer;
          this.currentSource.playbackRate.value = options.rate || 1.0;
          this.currentSource.connect(this.audioContext.destination);

          this.currentSource.onended = () => {
            this.currentSource = null;
            resolve();
          };

          this.currentSource.onerror = (e) => {
            console.error('[Janitor Voice] Audio playback error:', e);
            reject(e);
          };

          this.currentSource.start(0);
          console.log(`[Janitor Voice] Unreal Speech: Playing chunk ${chunkNum}/${totalChunks}`);
        });
      }

      console.log('[Janitor Voice] Unreal Speech: All chunks completed');
      if (onEnd) onEnd();

    } catch (e) {
      console.error('[Janitor Voice] Unreal Speech Error:', e);
      alert(`Unreal Speech Error: ${e.message}. Check console for details.`);
      if (onEnd) onEnd();
    }
  }

  cancel() {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) {
        // Source may have already ended
      }
      this.currentSource = null;
    }
  }

  getVoices() { return this.voices; }
}

// ============================================================================
// HIGHLIGHT MANAGER (Fixed)
// ============================================================================

class HighlightManager {
  constructor() {
    this.originalHTML = null;
    this.activeElement = null;
    this.wordMap = [];
  }

  /**
   * Prepares element for highlighting
   */
  start(element, spokenText) {
    this.stop(); // Clear previous

    if (!element || !element.isConnected) {
      console.warn('[Janitor Voice] Highlighter: Invalid element');
      return;
    }

    // Find the container. Fallback to element itself if query fails.
    let contentBody = element.querySelector(CONFIG.SELECTORS.messageBody) ||
      element.querySelector('.message-body') ||
      element;

    // Use the first Paragraph container if available, as that's usually where text is
    const firstP = contentBody.querySelector('p');
    if (firstP && firstP.parentElement) {
      // Highlighting works best if we target the parent of the Ps
      // But if 'contentBody' contains other junk, we want to be careful.
      // For Janitor, usually contentBody contains <p>s
    }

    this.activeElement = contentBody;
    this.originalHTML = contentBody.innerHTML;

    console.log('[Janitor Voice] Highlighter started on:', this.activeElement);

    // Reset Map
    this.wordMap = [];
    let globalCharIndex = 0;

    // Helper: Wrap text nodes
    const processNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue;
        if (!text.trim()) {
          globalCharIndex += text.length; // Count invisible whitespace
          return;
        }

        const fragment = document.createDocumentFragment();
        // Split by space, keeping delimiters
        const parts = text.split(/(\s+)/);

        parts.forEach(part => {
          if (!part) return;

          if (part.trim().length === 0) {
            fragment.appendChild(document.createTextNode(part));
            globalCharIndex += part.length;
          } else {
            const span = document.createElement('span');
            span.textContent = part;
            span.className = 'jv-tts-word';
            // Store strict range
            this.wordMap.push({
              start: globalCharIndex,
              end: globalCharIndex + part.length,
              span: span
            });
            fragment.appendChild(span);
            globalCharIndex += part.length;
          }
        });
        node.replaceWith(fragment);

      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (['SCRIPT', 'STYLE', 'BUTTON'].includes(node.tagName)) return;

        // Recurse
        Array.from(node.childNodes).forEach(processNode);

        // If this was a block element (like P or DIV), likely a newline in spoken text
        if (node.tagName === 'P' || node.tagName === 'DIV' || node.tagName === 'BR') {
          // The spoken text joining logic usually adds '\n' between paragraphs
          // We need to account for this implied character in our index
          // Check if the SPOKEN TEXT actually had a newline here. 
          // Simple heuristic: add 1 for newline if not end
          if (globalCharIndex < spokenText.length) {
            // Only increment if we match the spoken text format '...text\nNext...'
            // This is tricky. Let's assume the join('\n') from MessageDetector is consistent.
            // The simplest way is to NOT increment here, but ensure MessageDetector
            // joins with ' ' or we handle loose matching.
            //
            // BETTER FIX: MessageDetector joins with '\n'.
            // So we must increment globalCharIndex by 1 between Ps
            globalCharIndex += 1;
          }
        }
      }
    };

    // Process top-level children to handle the P-gap logic correctly
    const children = Array.from(contentBody.childNodes);
    children.forEach((child, index) => {
      processNode(child);
      // Add newline offset between block elements (Paragraphs)
      if (child.tagName === 'P' && index < children.length - 1) {
        // Because processNode recurses, it might have already handled it?
        // No, processNode handles "inside".
        // The "\n" is "between" them in the source string.
        // BUT: I added generic block handling inside processNode (recursive).
        // Let's rely on that recursive check (node.tagName === 'P') above.
        // Wait, recursively, 'processNode' is called on the P element. 
        // It processes children. Then returns.
        // So the check `if (node.tagName === 'P')` at the end of `processNode` execution is correct.
      }
    });
  }

  highlight(charIndex) {
    if (!this.activeElement) return;

    // Fuzzy Match: 
    // Browsers often fire boundary events at slightly different indices than our DOM calculation
    // especially with special characters or emojis.
    // We look for a word that *contains* or is *closest* to the charIndex.

    // Strict Containment
    let match = this.wordMap.find(w => charIndex >= w.start && charIndex < w.end);

    // If no strict match (e.g. index is at a space between words), try next word
    if (!match) {
      match = this.wordMap.find(w => w.start >= charIndex);
    }

    // Cleanup previous
    const prev = this.activeElement.querySelector('.jv-tts-highlight');
    if (prev) prev.classList.remove('jv-tts-highlight');

    // Apply new
    if (match && match.span) {
      match.span.classList.add('jv-tts-highlight');
    }
  }

  stop() {
    if (this.activeElement && this.originalHTML) {
      this.activeElement.innerHTML = this.originalHTML;
    }
    this.activeElement = null;
    this.originalHTML = null;
    this.wordMap = [];
  }
}

// ============================================================================
// OVERLAY MANAGER
// ============================================================================

class OverlayManager {
  constructor() {
    this.overlay = null;
  }
  create() {
    if (document.getElementById(CONFIG.UI.overlayId)) return;
    this.overlay = document.createElement('div');
    this.overlay.id = CONFIG.UI.overlayId;
    document.body.appendChild(this.overlay);
  }
  get() {
    if (!this.overlay) this.create();
    return this.overlay;
  }
}

// ============================================================================
// MIC BUTTON INJECTOR
// ============================================================================

class MicButtonInjector {
  constructor(overlayManager, onInteraction) {
    this.overlayManager = overlayManager;
    this.onInteraction = onInteraction;
    this.items = new Map();
    this.rafId = null;
    this.startTracking();
  }

  inject(messageElement, text) {
    if (this.items.has(messageElement)) return;
    if (!messageElement.isConnected) return;

    const button = document.createElement('button');
    button.className = 'jv-mic-button';
    button.innerHTML = '🎤';
    button.setAttribute('aria-label', 'Play Voice');
    button.title = 'Speak Message';

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onInteraction(messageElement, text, button);
    });

    this.overlayManager.get().appendChild(button);
    this.items.set(messageElement, { button, text });
    this.updateSinglePosition(messageElement, button);
  }

  startTracking() {
    const loop = () => {
      this.updatePositions();
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  updatePositions() {
    const vH = window.innerHeight;
    const vW = window.innerWidth;
    for (const [element, item] of this.items) {
      this.updateSinglePosition(element, item.button, vH, vW);
    }
  }

  updateSinglePosition(element, button, vH, vW) {
    if (!element.isConnected) {
      button.style.display = 'none';
      if (!document.contains(element)) this.cleanup(element);
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > (vH || window.innerHeight)) {
      button.style.display = 'none';
      return;
    }
    button.style.display = 'flex';
    const top = rect.top + 10;
    const left = rect.right - 42;
    button.style.transform = `translate(${left}px, ${top}px)`;
  }

  cleanup(element) {
    const item = this.items.get(element);
    if (item) {
      item.button.remove();
      this.items.delete(element);
    }
  }

  setButtonState(button, state) {
    if (state === 'playing') {
      button.classList.add('is-playing');
      button.classList.remove('is-paused');
      button.innerHTML = '⏸';
    } else if (state === 'paused') {
      button.classList.add('is-paused');
      button.classList.remove('is-playing');
      button.innerHTML = '▶';
    } else {
      button.classList.remove('is-playing', 'is-paused');
      button.innerHTML = '🎤';
    }
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    this.items.forEach(item => item.button.remove());
    this.items.clear();
  }
}

// ============================================================================
// UI PANEL
// ============================================================================

class UIPanel {
  constructor(controller) {
    this.controller = controller;
    this.panel = null;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.isMinimized = false;
  }

  create() {
    if (document.getElementById(CONFIG.UI.panelId)) return;
    this.panel = document.createElement('div');
    this.panel.id = CONFIG.UI.panelId;
    this.panel.className = 'janitor-voice-panel';
    // Using tabs structure
    this.panel.innerHTML = `
      <div class="jv-header" id="jv-drag-handle">
        <div class="jv-title"><span class="jv-icon">🎤</span><span>Janitor Voice</span></div>
        <div class="jv-actions">
          <button class="jv-btn-minimize" id="jv-minimize">−</button>
          <button class="jv-btn-close" id="jv-close">×</button>
        </div>
      </div>
      <div class="jv-body" id="jv-body">
        
        <div class="jv-control">
          <label class="jv-toggle-label">
            <input type="checkbox" id="jv-toggle" />
            <span class="jv-toggle-slider"></span>
            <span class="jv-toggle-text">Enable Voice</span>
          </label>
        </div>

        <div class="jv-tabs">
          <div class="jv-tab" data-provider="${CONFIG.PROVIDERS.WEB}">Free <span class="jv-badge free">Web</span></div>
          <div class="jv-tab" data-provider="${CONFIG.PROVIDERS.ELEVEN}">11Labs <span class="jv-badge premium">Pro</span></div>
          <div class="jv-tab" data-provider="${CONFIG.PROVIDERS.UNREAL}">Unreal <span class="jv-badge premium">Pro</span></div>
        </div>

        <!-- SHARED VOICE CONTROLS (Rate/Pitch apply to most, but we'll show conditionally or always if supported) -->
        <!-- Web Speech Settings -->
        <div class="jv-provider-section" id="section-${CONFIG.PROVIDERS.WEB}">
           <div class="jv-control">
            <label class="jv-label"><span>Speed</span><span class="jv-value" id="jv-rate-value">1.0x</span></label>
            <input type="range" id="jv-rate" min="0.5" max="2" step="0.1" value="1" />
           </div>
           <div class="jv-control">
            <label class="jv-label"><span>Pitch</span><span class="jv-value" id="jv-pitch-value">1.0</span></label>
            <input type="range" id="jv-pitch" min="0.5" max="2" step="0.1" value="1" />
           </div>
        </div>

        <!-- ElevenLabs Settings -->
        <div class="jv-provider-section" id="section-${CONFIG.PROVIDERS.ELEVEN}" style="display:none">
          <div class="jv-input-group">
            <label class="jv-label">API Key</label>
            <div class="jv-input-wrapper">
              <input type="password" id="jv-eleven-key" class="jv-input" placeholder="sk-..." />
              <button class="jv-btn-save" id="jv-save-eleven">Save</button>
            </div>
            <div class="jv-connection-status" id="jv-status-eleven"></div>
          </div>
          <div class="jv-control" style="margin-top:8px;">
            <label class="jv-label">Speed <span class="jv-value" id="jv-rate-eleven-val">1.0x</span></label>
             <!-- Reusing the main rate slider event logic but physically separate inputs? 
                  Alternatively, use one shared slider. Let's use shared logic but update description.
                  For simplicity, let's reuse the Rate slider from the main section but move it out? 
                  Actually, separate sections is cleaner for specific params. 
                  But all engines support Rate. Let's duplicate or move the slider. 
                  Let's just show the Shared controls for all, but pitch only for Web.
              -->
          </div>
        </div>

        <!-- Unreal Speech Settings -->
        <div class="jv-provider-section" id="section-${CONFIG.PROVIDERS.UNREAL}" style="display:none">
          <div class="jv-input-group">
            <label class="jv-label">API Key</label>
            <div class="jv-input-wrapper">
              <input type="password" id="jv-unreal-key" class="jv-input" placeholder="Bearer Token" />
              <button class="jv-btn-save" id="jv-save-unreal">Save</button>
            </div>
            <div class="jv-connection-status" id="jv-status-unreal"></div>
          </div>
        </div>
        
        <!-- Shared Voice Select -->
        <div class="jv-control">
          <label class="jv-label">Voice Model</label>
          <select id="jv-voice" class="jv-select"><option>Loading...</option></select>
        </div>

        <div class="jv-status" id="jv-status">Ready</div>
      </div>
    `;
    document.body.appendChild(this.panel);
    this.setupEventListeners();
    this.loadSettings();
  }

  setupEventListeners() {
    this.setupDrag();

    // Toggle
    this.panel.querySelector('#jv-toggle').addEventListener('change', (e) => {
      this.controller.setEnabled(e.target.checked);
      this.updateStatus();
    });

    // Min/Close
    this.panel.querySelector('#jv-minimize').addEventListener('click', () => {
      this.isMinimized = !this.isMinimized;
      this.panel.querySelector('#jv-body').style.display = this.isMinimized ? 'none' : 'flex';
      this.panel.querySelector('#jv-minimize').textContent = this.isMinimized ? '+' : '−';
    });
    this.panel.querySelector('#jv-close').addEventListener('click', () => {
      this.panel.style.display = 'none';
      // Ideally this should disable the extension or just hide UI? 
      // Just hide UI. Extension remains active in background.
    });

    // Rate / Pitch
    const rateEl = this.panel.querySelector('#jv-rate');
    rateEl.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.panel.querySelector('#jv-rate-value').textContent = val.toFixed(1) + 'x';
      this.controller.setRate(val);
    });
    const pitchEl = this.panel.querySelector('#jv-pitch');
    pitchEl.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.panel.querySelector('#jv-pitch-value').textContent = val.toFixed(1);
      this.controller.setPitch(val);
    });

    // Voice Select
    this.panel.querySelector('#jv-voice').addEventListener('change', (e) => {
      this.controller.setVoice(e.target.value);
    });

    // API Keys
    this.panel.querySelector('#jv-save-eleven').addEventListener('click', () => {
      const val = this.panel.querySelector('#jv-eleven-key').value.trim();
      this.controller.setElevenLabsKey(val);
      this.updateKeyStatus('eleven', !!val);
      // Refresh voices
      this.populateVoices();
    });
    this.panel.querySelector('#jv-save-unreal').addEventListener('click', () => {
      const val = this.panel.querySelector('#jv-unreal-key').value.trim();
      this.controller.setUnrealKey(val);
      this.updateKeyStatus('unreal', !!val);
      // Refresh voices
      this.populateVoices();
    });

    // Tabs
    const tabs = this.panel.querySelectorAll('.jv-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const provider = tab.dataset.provider;
        this.switchProvider(provider);
      });
    });
  }

  setupDrag() {
    const header = this.panel.querySelector('#jv-drag-handle');
    header.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      const rect = this.panel.getBoundingClientRect();
      this.dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.panel.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      e.preventDefault();
      const x = Math.max(0, Math.min(e.clientX - this.dragOffset.x, window.innerWidth - this.panel.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - this.dragOffset.y, window.innerHeight - this.panel.offsetHeight));
      this.panel.style.left = x + 'px';
      this.panel.style.top = y + 'px';
    });
    document.addEventListener('mouseup', () => {
      this.isDragging = false;
      this.panel.style.cursor = 'default';
    });
  }

  switchProvider(provider) {
    // Update active tab UI
    this.panel.querySelectorAll('.jv-tab').forEach(t => {
      if (t.dataset.provider === provider) t.classList.add('active');
      else t.classList.remove('active');
    });

    // Show/Hide sections
    this.panel.querySelector(`#section-${CONFIG.PROVIDERS.WEB}`).style.display =
      (provider === CONFIG.PROVIDERS.WEB) ? 'block' : 'none';

    this.panel.querySelector(`#section-${CONFIG.PROVIDERS.ELEVEN}`).style.display =
      (provider === CONFIG.PROVIDERS.ELEVEN) ? 'block' : 'none';

    this.panel.querySelector(`#section-${CONFIG.PROVIDERS.UNREAL}`).style.display =
      (provider === CONFIG.PROVIDERS.UNREAL) ? 'block' : 'none';

    // Update Controller
    this.controller.setProvider(provider);

    // Refresh Voices
    this.populateVoices();
  }

  async populateVoices() {
    const select = this.panel.querySelector('#jv-voice');
    select.innerHTML = '<option>Loading voices...</option>';
    select.disabled = true;

    try {
      const voices = await this.controller.getVoices();
      select.innerHTML = '';
      select.disabled = false;

      if (voices.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = 'No voices found (Check API Key)';
        select.appendChild(opt);
        return;
      }

      voices.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = `${v.name}`;
        select.appendChild(opt);
      });

      // Set selected
      const current = this.controller.getSettings().voiceURI;
      if (current) select.value = current;

    } catch (e) {
      console.error(e);
      select.innerHTML = '<option>Error loading voices</option>';
    }
  }

  loadSettings() {
    const s = this.controller.getSettings();
    this.panel.querySelector('#jv-toggle').checked = s.enabled;
    this.panel.querySelector('#jv-rate').value = s.rate;
    this.panel.querySelector('#jv-rate-value').textContent = s.rate.toFixed(1) + 'x';
    this.panel.querySelector('#jv-pitch').value = s.pitch;
    this.panel.querySelector('#jv-pitch-value').textContent = s.pitch.toFixed(1);

    this.panel.querySelector('#jv-eleven-key').value = s.elevenLabsKey || '';
    this.panel.querySelector('#jv-unreal-key').value = s.unrealKey || '';

    this.updateKeyStatus('eleven', !!s.elevenLabsKey);
    this.updateKeyStatus('unreal', !!s.unrealKey);

    // Initial provider switch
    this.switchProvider(s.provider || CONFIG.PROVIDERS.WEB);
    this.updateStatus();
  }

  updateKeyStatus(provider, hasKey) {
    const status = this.panel.querySelector(`#jv-status-${provider}`);
    if (hasKey) {
      status.textContent = '✓ Key Saved';
      status.className = 'jv-connection-status connected';
    } else {
      status.textContent = '⚠ No API Key';
      status.className = 'jv-connection-status error';
    }
  }

  updateStatus(msg) {
    const status = this.panel.querySelector('#jv-status');
    if (msg) status.textContent = msg;
    else {
      const enabled = this.controller.getSettings().enabled;
      status.textContent = enabled ? '✓ Voice Active' : 'Voice Disabled';
      status.className = 'jv-status ' + (enabled ? 'active' : 'inactive');
    }
  }

  show() {
    this.panel.style.display = 'block';
  }
}

// ============================================================================
// MESSAGE DETECTOR
// ============================================================================

class MessageDetector {
  constructor(onNewMessage) {
    this.onNewMessage = onNewMessage;
    this.observer = null;
  }
  start() {
    const check = () => {
      const container = document.querySelector(CONFIG.SELECTORS.chatContainer) || document.body;
      if (!container) return;
      this.scan(container);
      this.observer = new MutationObserver((mutations) => {
        // Basic optimization: only scan if nodes added
        const hasNodes = mutations.some(m => m.addedNodes.length > 0);
        if (hasNodes) this.scan(container);
      });
      this.observer.observe(container, { childList: true, subtree: true });
    };
    if (!document.querySelector(CONFIG.SELECTORS.chatContainer)) setTimeout(check, 2000);
    else check();
  }
  scan(root) {
    const messages = root.querySelectorAll(CONFIG.SELECTORS.characterMessage);
    messages.forEach(msg => {
      const text = this.extractText(msg);
      if (text) this.onNewMessage(msg, text);
    });
  }
  extractText(element) {
    const paras = element.querySelectorAll('p');
    if (paras.length > 0) return Array.from(paras).map(p => p.textContent).join('\n');
    const clone = element.cloneNode(true);
    clone.querySelectorAll('button, script, style, ._messageControls_').forEach(el => el.remove());
    return clone.textContent.trim();
  }
}

// ============================================================================
// MAIN CONTROLLER
// ============================================================================

class VoiceController {
  constructor() {
    this.engines = {
      [CONFIG.PROVIDERS.WEB]: new WebSpeechTTS(),
      [CONFIG.PROVIDERS.ELEVEN]: new ElevenLabsTTS(),
      [CONFIG.PROVIDERS.UNREAL]: new UnrealSpeechTTS()
    };

    this.overlay = new OverlayManager();
    this.uiPanel = null;
    this.injector = null;
    this.detector = null;
    this.highlighter = new HighlightManager();
    this.settings = StorageManager.loadSettings();

    this.currentButton = null;
    this.playbackState = 'IDLE';
  }

  async init() {
    await this.engines[CONFIG.PROVIDERS.WEB].initialize();

    // Initialize keys
    this.engines[CONFIG.PROVIDERS.ELEVEN].setApiKey(this.settings.elevenLabsKey);
    this.engines[CONFIG.PROVIDERS.UNREAL].setApiKey(this.settings.unrealKey);

    this.overlay.create();
    this.uiPanel = new UIPanel(this);
    this.uiPanel.create();

    this.injector = new MicButtonInjector(this.overlay, (element, text, button) => {
      this.handleInteraction(element, text, button);
    });

    this.detector = new MessageDetector((element, text) => {
      if (this.settings.enabled) {
        this.injector.inject(element, text);
      }
    });
    this.detector.start();

    // Listener for popup messages
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'SHOW_PANEL') {
        this.uiPanel.show();
      }
    });

    // Use visibility change to pause/resume
    document.addEventListener('visibilitychange', () => {
      if (this.playbackState === 'PLAYING') {
        const engine = this.getActiveEngine();
        if (engine && typeof engine.pause === 'function') {
          if (document.hidden) engine.pause();
          else engine.resume();
        }
      }
    });

    console.log('[Janitor Voice] v4.0 Multi-Provider Initialized');
  }

  getActiveEngine() {
    return this.engines[this.settings.provider] || this.engines[CONFIG.PROVIDERS.WEB];
  }

  handleInteraction(element, text, button) {
    if (this.currentButton === button) {
      if (this.playbackState === 'PLAYING') {
        // Not all engines support pause, but we try
        const engine = this.getActiveEngine();
        if (engine.pause) {
          engine.pause();
          this.setPlaybackState(button, 'PAUSED');
        } else {
          // If pause not supported, just stop
          this.stop();
        }
      } else if (this.playbackState === 'PAUSED') {
        const engine = this.getActiveEngine();
        if (engine.resume) {
          engine.resume();
          this.setPlaybackState(button, 'PLAYING');
        } else {
          // Replay if resume not supported
          this.play(element, text, button);
        }
      } else {
        this.play(element, text, button);
      }
      return;
    }

    if (this.currentButton) {
      this.stop();
    }

    this.play(element, text, button);
  }

  stop() {
    Object.values(this.engines).forEach(e => e.cancel());
    this.highlighter.stop();
    if (this.currentButton) {
      this.injector.setButtonState(this.currentButton, 'idle');
      this.currentButton = null;
    }
    this.playbackState = 'IDLE';
    this.uiPanel.updateStatus();
  }

  play(element, text, button) {
    this.stop(); // Ensure everything is stopped first

    this.currentButton = button;
    this.setPlaybackState(button, 'PLAYING'); // Optimistic state

    // START HIGHLIGHTING (Only works well with WebSpeech boundary events usually, but we try)
    this.highlighter.start(element, text);

    const engine = this.getActiveEngine();

    // Show loading if async (Eleven/Unreal)
    if (this.settings.provider !== CONFIG.PROVIDERS.WEB) {
      this.injector.setButtonState(button, 'loading');
    }

    engine.speak(text, {
      rate: this.settings.rate,
      pitch: this.settings.pitch,
      volume: this.settings.volume,
      voiceURI: this.settings.voiceURI
    },
      // onEnd
      () => {
        console.log('[Janitor Voice] Playback Ended');
        if (this.currentButton === button) {
          this.stop();
        }
      },
      // onBoundary (Web Speech only mainly)
      (event) => {
        if (event.name === 'word') {
          this.highlighter.highlight(event.charIndex);
        }
      },
      // onProgress (Premium providers with chunking)
      (progressMsg) => {
        console.log('[Janitor Voice] Progress:', progressMsg);
        this.uiPanel.updateStatus(progressMsg);
        // Update button label for visual feedback
        const labelEl = button.querySelector('.jv-btn-label');
        if (labelEl) {
          labelEl.textContent = progressMsg;
        }
      }
    );

    // If provider is not web speech, remove loading state when it likely starts
    if (this.settings.provider !== CONFIG.PROVIDERS.WEB) {
      setTimeout(() => {
        if (this.currentButton === button && this.playbackState === 'PLAYING') {
          this.injector.setButtonState(button, 'playing');
        }
      }, 1000);
    }
  }

  setPlaybackState(button, state) {
    this.playbackState = state;
    if (state === 'PAUSED') {
      this.injector.setButtonState(button, 'paused');
      this.uiPanel.updateStatus('⏸ Paused');
    } else if (state === 'PLAYING') {
      this.injector.setButtonState(button, 'playing');
      this.uiPanel.updateStatus('🔊 Speaking...');
    } else {
      this.injector.setButtonState(button, 'idle');
      this.highlighter.stop();
    }
  }

  // Settings API
  setEnabled(enabled) {
    this.settings.enabled = enabled;
    StorageManager.set('enabled', enabled);
    if (!enabled) this.stop();
  }
  setRate(rate) { this.settings.rate = rate; StorageManager.set('rate', rate); }
  setPitch(pitch) { this.settings.pitch = pitch; StorageManager.set('pitch', pitch); }
  setVolume(vol) { this.settings.volume = vol; StorageManager.set('volume', vol); }

  setProvider(provider) {
    this.settings.provider = provider;
    StorageManager.set('provider', provider);
    // Reset voice URI when switching providers to default of that provider
    this.settings.voiceURI = '';
    this.stop();
  }

  setElevenLabsKey(key) {
    this.settings.elevenLabsKey = key;
    StorageManager.set('elevenLabsKey', key);
    this.engines[CONFIG.PROVIDERS.ELEVEN].setApiKey(key);
  }

  setUnrealKey(key) {
    this.settings.unrealKey = key;
    StorageManager.set('unrealKey', key);
    this.engines[CONFIG.PROVIDERS.UNREAL].setApiKey(key);
  }

  setVoice(voiceURI) {
    this.settings.voiceURI = voiceURI;
    StorageManager.set('voiceURI', voiceURI);
  }

  getSettings() { return this.settings; }

  async getVoices() {
    // Return voices for current provider
    const engine = this.getActiveEngine();
    // If it's an async fetch (ElevenLabs), ensure we try to fetch if empty
    if (engine instanceof ElevenLabsTTS && engine.voices.length === 0) {
      await engine.fetchVoices();
    }
    return engine.getVoices();
  }
}

if (!window.janitorVoiceLoaded) {
  window.janitorVoiceLoaded = true;
  const ctrl = new VoiceController();
  ctrl.init();
}
