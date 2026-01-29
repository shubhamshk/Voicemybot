# Cinematic Voice System - Phase 6 Documentation

## Overview
Phase 6 implements the **Experience Orchestration Layer** - the "conductor" that coordinates all systems, manages state, controls UX, and enforces business logic. This is the single entry point for all cinematic voice functionality.

---

## Architecture

### **The Conductor Model**

```
┌─────────────────────────────────────────────────────┐
│        PHASE 6: EXPERIENCE ORCHESTRATOR             │
│         (The Conductor - Controls Everything)       │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Global State Manager                       │   │
│  │  - Feature flags                            │   │
│  │  - Runtime state                            │   │
│  │  - Session tracking                         │   │
│  │  - Error state                              │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Control Flow Logic                         │   │
│  │  - Decide: Cinematic or Simple?             │   │
│  │  - Start/Stop pipeline                      │   │
│  │  - Session management                       │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  User Controls                              │   │
│  │  - Toggle cinematic mode                    │   │
│  │  - Play/Stop                                │   │
│  │  - Provider selection                       │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Error Orchestration                        │   │
│  │  - Catch all errors                         │   │
│  │  - User-friendly messages                   │   │
│  │  - Safe recovery                            │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
└────────┬────────────────────────────────────┬──────┘
         │                                    │
         ▼                                    ▼
┌────────────────────┐            ┌────────────────────┐
│  CINEMATIC MODE    │            │   SIMPLE MODE      │
│  (Phases 1-5)      │            │  (Existing TTS)    │
└────────────────────┘            └────────────────────┘
```

---

## Core Components

### **1. CinematicStateManager**

**Purpose:** Single source of truth for all state

**State Structure:**
```javascript
{
  // Feature flags
  isCinematicModeEnabled: boolean,
  isPremiumUser: boolean,
  
  // Runtime state
  isGenerating: boolean,
  isPlaying: boolean,
  isActive: boolean,
  
  // Configuration
  currentProvider: 'web_speech' | 'eleven_labs' | 'unreal_speech',
  
  // Session tracking
  currentSessionId: string | null,
  currentStoryText: string | null,
  
  // Progress tracking
  statusMessage: string,
  currentPhase: 'parsing' | 'generating' | 'playing' | null,
  progress: { current: number, total: number },
  
  // Error state
  hasError: boolean,
  errorMessage: string | null,
  errorDetails: string | null
}
```

**Methods:**
- `getState()` - Get current state (read-only copy)
- `setState(updates)` - Update state and notify listeners
- `subscribe(listener)` - Subscribe to state changes
- `reset()` - Reset to initial state

---

### **2. CinematicExperienceOrchestrator**

**Purpose:** High-level coordinator that manages entire UX

**Location:** Lines 1890-2227

**Key Methods:**

#### **initialize()**
- Load settings from storage
- Check premium status
- Log initialization

#### **toggleCinematicMode()**
- Toggle cinematic mode ON/OFF
- Check premium access
- Save to storage

#### **play(storyText, options)**
- **Main entry point** for playback
- Decides: Cinematic or Simple?
- Manages session lifecycle
- Handles errors

#### **playCinematic(storyText, sessionId)**
- Runs full cinematic pipeline (Phases 1-5)
- Wires up callbacks
- Updates status

#### **playSimple(storyText, sessionId)**
- Uses existing single-voice TTS
- Backward compatible
- Future: integrates with VoiceController

#### **stop()**
- Stop current playback
- Reset state
- Clean up

#### **handleError(error, context)**
- Catch all errors
- User-friendly messages
- Safe recovery

---

### **3. CinematicVoiceAPI**

**Purpose:** Clean, high-level API for UI integration

**Location:** Lines 2247-2303

**Methods:**

```javascript
CinematicVoiceAPI.init()                    // Initialize system
CinematicVoiceAPI.play(text)                // Play story
CinematicVoiceAPI.stop()                    // Stop playback
CinematicVoiceAPI.toggleCinematicMode()     // Toggle mode
CinematicVoiceAPI.setProvider(provider)     // Set TTS provider
CinematicVoiceAPI.getState()                // Get current state
CinematicVoiceAPI.subscribe(listener)       // Subscribe to changes
CinematicVoiceAPI.isCinematicAvailable()    // Check premium
```

---

## Control Flow

### **Decision Point: Cinematic vs Simple**

```javascript
async play(storyText) {
  if (isCinematicModeEnabled) {
    // Run full pipeline
    Phase 1: Parse script
    Phase 2: Detect speakers
    Phase 3: Assign voices
    Phase 4: Generate audio
    Phase 5: Play audio
  } else {
    // Use existing TTS
    Simple single-voice playback
  }
}
```

---

## State Management

### **State Flow:**

```
┌─────────────┐
│   READY     │  statusMessage: "Ready"
└──────┬──────┘  isActive: false
       │
       │ play()
       ▼
┌─────────────┐
│   PARSING   │  statusMessage: "Analyzing story..."
└──────┬──────┘  currentPhase: "parsing"
       │          isActive: true
       ▼
┌─────────────┐
│ GENERATING  │  statusMessage: "Generating voices..."
└──────┬──────┘  currentPhase: "generating"
       │          isGenerating: true
       ▼
┌─────────────┐
│   PLAYING   │  statusMessage: "Playing cinematic scene..."
└──────┬──────┘  currentPhase: "playing"
       │          isPlaying: true
       ▼
┌─────────────┐
│  COMPLETE   │  statusMessage: "Scene finished"
└─────────────┘  isActive: false

stop() can interrupt at any point → READY
```

---

### **State Change Listeners:**

```javascript
// Subscribe to state changes
const unsubscribe = CinematicVoiceAPI.subscribe((newState, oldState) => {
  console.log('State changed:', newState);
  
  // Update UI based on state
  if (newState.isPlaying) {
    disableMicButton();
    showStatus(newState.statusMessage);
  }
  
  if (newState.hasError) {
    showError(newState.errorMessage);
  }
});

// Later: unsubscribe when done
unsubscribe();
```

---

## User Controls

### **1. Toggle Cinematic Mode**

```javascript
const enabled = CinematicVoiceAPI.toggleCinematicMode();

if (enabled) {
  console.log('✅ Cinematic mode enabled');
  // Multi-voice narration with character detection
} else {
  console.log('⬜ Simple mode enabled');  
  // Traditional single-voice TTS
}
```

**Logic:**
1. Check premium status
2. If free user → show upgrade message
3. If premium → toggle and save

---

### **2. Play/Stop Controls**

```javascript
// Play
await CinematicVoiceAPI.play(storyText);

// Stop
CinematicVoiceAPI.stop();
```

**Behavior:**
- Only ONE session can be active
- Calling `play()` while active → stops previous session
- Calling `stop()` → immediate silence, state reset

---

### **3. Provider Selection**

```javascript
CinematicVoiceAPI.setProvider('web_speech');    // Free
CinematicVoiceAPI.setProvider('eleven_labs');   // Premium
CinematicVoiceAPI.setProvider('unreal_speech'); // Premium
```

**Storage:** Persists to `localStorage` for next session

---

## Progress & Feedback

### **Status Messages:**

| Phase | Status Message |
|-------|----------------|
| Ready | "Ready" |
| Parsing | "Analyzing story..." |
| Character Detection | "Detecting characters..." |
| Voice Assignment | "Assigning voices..." |
| Generating | "Generating voices..." |
| Playing | "Playing cinematic scene..." |
| Complete | "Scene finished" |
| Error | "Error" |

### **Real-time Updates:**

```javascript
CinematicVoiceAPI.subscribe((state) => {
  document.querySelector('#status').textContent = state.statusMessage;
  
  if (state.currentPhase === 'parsing') {
    showSpinner();
  } else if (state.currentPhase === 'playing') {
    showPlayingAnimation();
  }
});
```

---

## Error Orchestration

### **Error Handling Flow:**

```
Error occurs in any phase
       ↓
handleError(error, context)
       ↓
1. Log error to console
2. Determine user-friendly message
3. Update error state
4. Show alert to user
5. Reset system safely
```

### **User-Friendly Error Messages:**

```javascript
// API Key missing
"API key not configured. Please add your API key in settings."

// Network error
"Network error. Please check your connection."

// Quota exceeded
"API quota exceeded. Please check your account."

// Generic
"An error occurred during playback"
```

### **Example:**

```javascript
try {
  await CinematicVoiceAPI.play(text);
} catch (error) {
  // Caught by orchestrator
  // User sees friendly message
  // State is reset safely
  // No frozen UI
}
```

---

## Premium Gating

### **Access Control:**

```javascript
toggleCinematicMode() {
  if (!isPremiumUser) {
    // Show upgrade message
    alert('🎭 Cinematic Voice Mode is a Premium Feature...');
    return false;
  }
  
  // Enable cinematic mode
  return true;
}
```

**Future Enhancement:**
```javascript
checkPremiumStatus() {
  // Check actual subscription
  const subscription = await fetch('/api/subscription');
  const isPremium = subscription.plan === 'pro';
  
  setState({ isPremiumUser: isPremium });
}
```

---

## Session Management

### **Single Session Enforcement:**

```javascript
async play(text) {
  // Check if already active
  if (isActive) {
    console.log('Already active, stopping first...');
    stop(); // Stop previous session
  }
  
  // Start new session
  const sessionId = `session_${Date.now()}`;
  setState({
    isActive: true,
    currentSessionId: sessionId,
    currentStoryText: text
  });
  
  // ... continue with playback
}
```

**Benefits:**
- No overlapping sessions
- Clean state transitions
- No memory leaks

---

## Integration Example

### **In Existing Mic Button Handler:**

```javascript
// In VoiceController or mic button click handler
async function handleMicClick() {
  const messageText = getLatestJanitorMessage();
  
  // Get current state
  const state = CinematicVoiceAPI.getState();
  
  // If already playing, stop
  if (state.isActive) {
    CinematicVoiceAPI.stop();
    updateMicButton('idle');
    return;
  }
  
  // Start playback
  updateMicButton('loading');
  
  try {
    await CinematicVoiceAPI.play(messageText);
    updateMicButton('idle');
  } catch (error) {
    console.error('Playback failed:', error);
    updateMicButton('error');
  }
}
```

---

### **Adding Cinematic Toggle to Settings:**

```javascript
// In UIPanel or settings
const toggle = document.createElement('label');
toggle.innerHTML = `
  <input type="checkbox" id="cinematicToggle" />
  <span>Cinematic Voice Mode</span>
  <span class="badge premium">PRO</span>
`;

const checkbox = toggle.querySelector('#cinematicToggle');

// Load initial state
checkbox.checked = CinematicVoiceAPI.getState().isCinematicModeEnabled;

// Handle toggle
checkbox.addEventListener('change', (e) => {
  const enabled = CinematicVoiceAPI.toggleCinematicMode();
  e.target.checked = enabled; // Sync with actual state (might be denied)
});
```

---

## Testing

### **Test Function:**

```javascript
testExperienceOrchestration();
```

**Test Coverage:**
1. Initial state validation
2. Toggle cinematic mode
3. Play with cinematic mode
4. State changes during playback
5. Error handling
6. Session management

**To Run:**
```javascript
// Uncomment in content.js:
testExperienceOrchestration();
```

---

## API Reference

### **CinematicStateManager**

| Method | Description |
|--------|-------------|
| `getState()` | Get current state (read-only) |
| `setState(updates)` | Update state |
| `subscribe(listener)` | Subscribe to changes |
| `reset()` | Reset to initial state |

### **CinematicExperienceOrchestrator**

| Method | Description |
|--------|-------------|
| `initialize()` | Load settings, check premium |
| `toggleCinematicMode()` | Toggle mode ON/OFF |
| `setProvider(provider)` | Set TTS provider |
| `play(text)` | Play story (cinematic or simple) |
| `playCinematic(text)` | Play with full pipeline |
| `playSimple(text)` | Play with existing TTS |
| `stop()` | Stop playback |
| `handleError(error)` | Handle errors gracefully |
| `getState()` | Get current state |
| `subscribe(listener)` | Subscribe to changes |

### **CinematicVoiceAPI** (Recommended)

| Method | Description |
|--------|-------------|
| `init()` | Initialize system |
| `play(text)` | Play story |
| `stop()` | Stop playback |
| `toggleCinematicMode()` | Toggle mode |
| `setProvider(provider)` | Set provider |
| `getState()` | Get state |
| `subscribe(listener)` | Subscribe |
| `isCinematicAvailable()` | Check premium |

---

## What Phase 6 Does

✅ **Global State Management** - Single source of truth  
✅ **Control Flow Logic** - Decides cinematic vs simple  
✅ **User Controls** - Toggle, play, stop, provider  
✅ **Progress Feedback** - Real-time status updates  
✅ **Error Orchestration** - Graceful error handling  
✅ **Premium Gating** - Enforce feature access  
✅ **Session Management** - Single session enforcement  
✅ **Clean API** - High-level integration interface  
✅ **State Change Notifications** - Observer pattern  

## What Phase 6 Does NOT Do

❌ Parse text (Phase 1)  
❌ Detect speakers (Phase 2)  
❌ Assign voices (Phase 3)  
❌ Generate audio (Phase 4)  
❌ Play audio (Phase 5)  

---

## Future Extensibility

Phase 6 is designed to easily accommodate new features:

### **Emotion Detection:**
```javascript
const result = parseScriptComplete(text);
const emotions = detectEmotions(result.script); // NEW
assignVoicesWithEmotion(result.registry, emotions); // ENHANCED
```

### **Background Music:**
```javascript
playCinematic(text) {
  playBackgroundMusic('ambient');  // NEW
  await orchestrator.playCinematic(text);
  stopBackgroundMusic(); // NEW
}
```

### **Subtitles:**
```javascript
consumer.onChunkStart = (chunk) => {
  showSubtitle(chunk.text); // NEW
};
```

### **Export Audio:**
```javascript
exportAudio() {
  const queue = producer.getQueue();
  const audioBlobs = queue.map(chunk => chunk.audio);
  const combined = combineAudio(audioBlobs); // NEW
  download(combined, 'story.mp3');
}
```

---

## Status

✅ **Phase 1:** Script Parsing (COMPLETE)  
✅ **Phase 2:** Speaker Detection (COMPLETE)  
✅ **Phase 3:** Gender Detection & Voice Casting (COMPLETE)  
✅ **Phase 4:** Streaming Audio Producer (COMPLETE)  
✅ **Phase 5:** Streaming Audio Consumer (COMPLETE)  
✅ **Phase 6:** Experience Orchestration Layer (COMPLETE) ← **YOU ARE HERE**  

🎉 **ENTIRE SYSTEM COMPLETE!**

---

**Created:** 2026-01-29  
**Last Updated:** 2026-01-29  
**Version:** 1.0.0
