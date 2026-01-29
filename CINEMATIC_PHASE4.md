# Cinematic Voice System - Phase 4 Documentation

## Overview
Phase 4 implements the **Streaming Audio Producer** - a producer-consumer pattern that generates TTS audio chunks in real-time and pushes them to a queue. This enables instant playback start while the rest of the story is still being generated.

---

## Architecture

### **Producer-Consumer Pattern**

```
┌─────────────────────────────────────────────────┐
│          AUDIO PRODUCER (Phase 4)               │
│  ┌───────────────────────────────────────────┐  │
│  │  Read Script Block                        │  │
│  │        ↓                                  │  │
│  │  Split into Chunks (smartSplit)           │  │
│  │        ↓                                  │  │
│  │  Generate TTS (provider-agnostic)         │  │
│  │        ↓                                  │  │
│  │  Push to Audio Queue                      │  │
│  │        ↓                                  │  │
│  │  Repeat for next block                    │  │
│  └───────────────────────────────────────────┘  │
└──────────────────┬──────────────────────────────┘
                   │ Audio Queue
                   ▼
┌─────────────────────────────────────────────────┐
│       AUDIO CONSUMER (Phase 5 - Future)         │
│  ┌───────────────────────────────────────────┐  │
│  │  Poll Queue                               │  │
│  │        ↓                                  │  │
│  │  Play Audio Chunk                         │  │
│  │        ↓                                  │  │
│  │  Wait for completion                      │  │
│  │        ↓                                  │  │
│  │  Repeat                                   │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

---

## Core Class: AudioProducer

### **Constructor**

```javascript
const producer = new AudioProducer('web_speech');
```

**Parameters:**
- `provider` - TTS provider: `'web_speech'`, `'eleven_labs'`, or `'unreal_speech'`

**Properties:**
```javascript
{
  provider: string,
  audioQueue: Array,
  isGenerating: boolean,
  generatedCount: number,
  totalBlocks: number,
  currentBlock: number,
  onProgress: Function,
  onComplete: Function,
  onError: Function
}
```

---

## Key Methods

### **1. generateScript(script)**

**Location:** Lines 1217-1266

**Purpose:** Main entry point - generates audio for entire script

**Usage:**
```javascript
const result = parseScriptComplete(text);
const producer = new AudioProducer('web_speech');

producer.onProgress = (progress) => {
  console.log(`Block ${progress.current}/${progress.total}`);
};

await producer.generateScript(result.script);
```

**Flow:**
1. Initialize queue and counters
2. Loop through script blocks
3. Call `processBlock()` for each
4. Trigger `onComplete` when done

---

### **2. processBlock(block, blockIndex)**

**Location:** Lines 1159-1215

**Purpose:** Process single block with chunking support

**Flow:**
1. Split block text using `smartSplit(text, 900)`
2. For each chunk:
   - Call `generateTTS(chunkText, voice)`
   - Push result to queue
   - Update counters
   - Trigger `onProgress`
3. Handle errors gracefully (skip failed chunks)

**Example Output to Queue:**
```javascript
{
  audio: { type: 'audio_buffer', audioBuffer: AudioBuffer, text: "..." },
  voice: "male_voice_1",
  text: "Jack stood up.",
  speaker: "Jack",
  type: "narration",
  blockIndex: 0,
  chunkIndex: 0,
  totalChunks: 1
}
```

---

### **3. generateTTS(text, voiceId)**

**Location:** Lines 962-982

**Purpose:** Provider-agnostic audio generation

**Routing:**
```javascript
if (provider === 'web_speech') → generateWebSpeech()
if (provider === 'eleven_labs') → generateElevenLabs()
if (provider === 'unreal_speech') → generateUnrealSpeech()
```

**Returns:**
```javascript
// For Web Speech
{
  type: 'web_speech_utterance',
  utterance: SpeechSynthesisUtterance,
  text: string
}

// For Premium Providers
{
  type: 'audio_buffer',
  audioBuffer: AudioBuffer,
  text: string
}
```

---

### **4. mapVoiceToProvider(voiceId, provider)**

**Location:** Lines 900-960

**Purpose:** Map generic voice IDs from Phase 3 to actual provider voices

**Web Speech Mapping:**
```javascript
'male_voice_1' → First male browser voice (David, Mark, George)
'female_voice_1' → First female browser voice (Zira, Susan)
'narrator_voice' → Male voice for narration
```

**ElevenLabs/Unreal Speech:**
- Returns `null` (uses provider defaults)
- Can be extended for specific voice IDs

---

## Provider-Specific Generation

### **Web Speech API**

**Function:** `generateWebSpeech(text, voiceURI)`

**Returns:** Utterance object (not actual audio data)

```javascript
{
  type: 'web_speech_utterance',
  utterance: new SpeechSynthesisUtterance(text),
  text: text
}
```

**Note:** Web Speech API doesn't provide audio data. The utterance is prepared but not spoken. Phase 5 will handle playback.

---

### **ElevenLabs API**

**Function:** `generateElevenLabs(text, voiceId)`

**API Call:**
```javascript
POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}
Headers:
  - Content-Type: application/json
  - xi-api-key: {API_KEY}
Body:
  {
    text: string,
    model_id: "eleven_turbo_v2_5",
    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
  }
```

**Returns:**
```javascript
{
  type: 'audio_buffer',
  audioBuffer: AudioBuffer, // Decoded MP3
  text: string
}
```

---

### **Unreal Speech API**

**Function:** `generateUnrealSpeech(text, voiceId)`

**API Call:**
```javascript
POST https://api.v6.unrealspeech.com/stream
Headers:
  - Authorization: Bearer {API_KEY}
  - Content-Type: application/json
Body:
  {
    Text: string,
    VoiceId: string,
    Bitrate: "192k",
    Speed: "0",
    Pitch: "1.0",
    Codec: "libmp3lame"
  }
```

**Returns:**
```javascript
{
  type: 'audio_buffer',
  audioBuffer: AudioBuffer, // Decoded MP3
  text: string
}
```

---

## Audio Queue Structure

### **Queue Item Format:**

```javascript
{
  audio: {
    type: 'audio_buffer' | 'web_speech_utterance',
    audioBuffer?: AudioBuffer,
    utterance?: SpeechSynthesisUtterance,
    text: string
  },
  voice: string,          // Generic voice ID
  text: string,           // Chunk text
  speaker: string,        // Character name
  type: 'narration' | 'dialogue',
  blockIndex: number,     // Original block index
  chunkIndex: number,     // Chunk index within block
  totalChunks: number     // Total chunks for this block
}
```

---

## State Management

### **getState()**

Returns current generation state:

```javascript
{
  isGenerating: boolean,
  generatedCount: number,    // Total audio chunks generated
  totalBlocks: number,       // Total script blocks
  currentBlock: number,      // Current block being processed
  queueSize: number          // Current queue size
}
```

### **getQueue()**

Returns the entire audio queue (safe to call during generation).

### **stop()**

Stops generation and clears queue.

---

## Callbacks

### **onProgress**

**Triggered:** After each chunk is generated

**Payload:**
```javascript
{
  current: number,           // Current block (1-indexed)
  total: number,             // Total blocks
  generatedAudioChunks: number,
  queueSize: number
}
```

**Example:**
```javascript
producer.onProgress = (progress) => {
  console.log(`Generating ${progress.current}/${progress.total}`);
  updateUI(`Processing block ${progress.current}/${progress.total}`);
};
```

---

### **onComplete**

**Triggered:** When all blocks are processed

**Payload:**
```javascript
{
  totalChunks: number,
  queueSize: number
}
```

**Example:**
```javascript
producer.onComplete = (result) => {
  console.log(`Done! Generated ${result.totalChunks} chunks`);
};
```

---

### **onError**

**Triggered:** When chunk generation fails

**Payload:**
```javascript
{
  block: Object,      // The block that failed
  chunkIndex: number,
  error: Error
}
```

**Example:**
```javascript
producer.onError = (error) => {
  console.error('Failed to generate:', error.block.text);
  // Continue with other chunks (non-fatal)
};
```

---

## Text Chunking Integration

Uses existing `smartSplit()` function from earlier phases:

```javascript
const chunks = smartSplit(block.text, 900);
// Returns: ["chunk1", "chunk2", ...]
```

**Benefits:**
- Prevents API character limit errors
- Each chunk generated independently
- Natural sentence boundaries preserved

---

## Error Handling

### **Graceful Degradation:**

1. **Chunk-Level Errors:**
   - Log error
   - Call `onError` callback
   - **Continue with next chunk** (don't fail entire block)

2. **Fatal Errors:**
   - Stop generation
   - Set `isGenerating = false`
   - Throw error

### **Error Types:**

```javascript
// API Key Missing
Error: 'ElevenLabs API key not configured'

// API Request Failed
Error: 'ElevenLabs API Error (402): Insufficient credits'

// Provider Unknown
Error: 'Unknown provider: xyz'
```

---

## Performance Characteristics

### **Streaming Timeline:**

```
Time 0ms:    generateScript() called
Time 100ms:  First chunk generated → pushed to queue
Time 200ms:  Second chunk generated → pushed to queue
             ↑ Phase 5 can start playing here
Time 300ms:  Third chunk generated → pushed to queue
Time 400ms:  All chunks done → onComplete()
```

**Key Benefit:** Playback can start after first chunk (~100ms), not after all chunks (~400ms).

---

### **Memory Usage:**

- **Queue grows linearly** with number of chunks
- **AudioBuffer size:** ~10-50KB per second of audio
- **Example:** 10-block script with 2s average = ~200-500KB total

---

### **Network:**

- **Web Speech:** No network (local)
- **ElevenLabs:** ~30-100KB per request
- **Unreal Speech:** ~50-150KB per request

---

## Example Usage

### **Complete Example:**

```javascript
// 1. Parse and prepare script
const text = 'Jack stood up. "Hello everyone!" Emily smiled. "Hi Jack!"';
const result = parseScriptComplete(text, ['Jack', 'Emily'], 'web_speech');

// 2. Create producer
const producer = new AudioProducer('web_speech');

// 3. Set callbacks
producer.onProgress = (progress) => {
  document.querySelector('#status').textContent = 
    `Generating ${progress.current}/${progress.total}`;
};

producer.onComplete = (result) => {
  console.log('Ready to play!', result.totalChunks, 'chunks');
};

producer.onError = (error) => {
  console.error('Generation error:', error);
};

// 4. Start generation
await producer.generateScript(result.script);

// 5. Access queue
const queue = producer.getQueue();
console.log('Queue:', queue);

// 6. Check state
const state = producer.getState();
console.log('State:', state);
```

---

## Console Output Example

```
[AudioProducer] ========== STARTING STREAMING GENERATION ==========
[AudioProducer] Provider: web_speech
[AudioProducer] Total blocks: 4

[AudioProducer] Processing block 1: narration
[AudioProducer] Split into 1 chunk(s)
[AudioProducer] Generating chunk 1/1: "Jack stood up."
[AudioProducer] Generating TTS: "Jack stood up." with voice: narrator_voice
[AudioProducer] ✓ Chunk 1/1 ready. Queue size: 1

[AudioProducer] Processing block 2: dialogue
[AudioProducer] Split into 1 chunk(s)
[AudioProducer] Generating chunk 1/1: "Hello everyone!"
[AudioProducer] Generating TTS: "Hello everyone!" with voice: male_voice_1
[AudioProducer] ✓ Chunk 1/1 ready. Queue size: 2

[AudioProducer] Processing block 3: narration
[AudioProducer] Split into 1 chunk(s)
[AudioProducer] Generating chunk 1/1: "Emily smiled."
[AudioProducer] Generating TTS: "Emily smiled." with voice: narrator_voice
[AudioProducer] ✓ Chunk 1/1 ready. Queue size: 3

[AudioProducer] Processing block 4: dialogue
[AudioProducer] Split into 1 chunk(s)
[AudioProducer] Generating chunk 1/1: "Hi Jack!"
[AudioProducer] Generating TTS: "Hi Jack!" with voice: female_voice_1
[AudioProducer] ✓ Chunk 1/1 ready. Queue size: 4

[AudioProducer] ========== GENERATION COMPLETE ==========
[AudioProducer] Generated 4 audio chunk(s)
[AudioProducer] Queue size: 4
```

---

## What Phase 4 Does

✅ Generates TTS audio for script blocks  
✅ Splits long text into chunks  
✅ Routes to appropriate provider (Web Speech/ElevenLabs/Unreal)  
✅ Maps generic voices to provider voices  
✅ Pushes audio chunks to queue in real-time  
✅ Tracks generation progress  
✅ Handles errors gracefully  
✅ Provides state inspection  

## What Phase 4 Does NOT Do

❌ Play audio (Phase 5)  
❌ Handle UI updates (Phase 5)  
❌ Implement premium gating (out of scope)  
❌ Voice configuration UI (out of scope)  

---

## Integration Status

Currently **standalone** - AudioProducer class is defined and tested but not integrated into main TTS flow.

**Future Integration (Phase 5):**
```javascript
// In VoiceController.play()
const result = parseScriptComplete(text);
const producer = new AudioProducer(currentProvider);

// Start generation
producer.generateScript(result.script);

// Start playback immediately (Phase 5)
const consumer = new AudioConsumer(producer);
consumer.play();
```

---

## Testing

### **Test Function:**

```javascript
testAudioProducer();
```

**⚠️ WARNING:** This test makes actual API calls and may consume credits for ElevenLabs/Unreal Speech.

### **Test Coverage:**
- Web Speech generation
- Voice mapping
- Chunking integration
- Progress tracking
- State management

---

## Next Steps (Phase 5)

### **Audio Consumer/Playback:**
1. **Poll queue** for available chunks
2. **Play chunks sequentially** in order
3. **Handle voice switching** between blocks
4. **Smooth transitions** between narration and dialogue
5. **UI feedback** during playback
6. **Pause/Resume/Stop** controls

---

## Status

✅ **Phase 1:** Script Parsing (COMPLETE)  
✅ **Phase 2:** Speaker Detection (COMPLETE)  
✅ **Phase 3:** Gender Detection & Voice Casting (COMPLETE)  
✅ **Phase 4:** Streaming Audio Producer (COMPLETE) ← **YOU ARE HERE**  
⏳ **Phase 5:** Cinematic Playback Consumer (Not Started)  

---

**Created:** 2026-01-29  
**Last Updated:** 2026-01-29  
**Version:** 1.0.0
