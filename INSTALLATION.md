# Janitor Voice - Installation & Testing Guide

## 📋 Quick Start Checklist

- [ ] Extension files created
- [ ] Icons generated
- [ ] Extension loaded in Chrome
- [ ] Tested on Janitor AI
- [ ] Voice settings configured

---

## 🚀 Step-by-Step Installation

### Step 1: Verify Files

Navigate to the extension folder and verify all files are present:

```
janitor-voice/
├── manifest.json       ✓
├── content.js          ✓
├── styles.css          ✓
├── popup.html          ✓
├── popup.js            ✓
├── icon16.png          ✓
├── icon48.png          ✓
├── icon128.png         ✓
└── README.md           ✓
```

### Step 2: Open Chrome Extensions Page

1. Open **Google Chrome**
2. Navigate to `chrome://extensions/`
3. **Alternative**: Click the menu (⋮) → More Tools → Extensions

### Step 3: Enable Developer Mode

1. Look for the **"Developer mode"** toggle in the top-right corner
2. Click to **enable** it
3. You should see new buttons appear: "Load unpacked", "Pack extension", etc.

### Step 4: Load the Extension

1. Click the **"Load unpacked"** button
2. In the file browser, navigate to:
   ```
   c:\Users\shubh\OneDrive\Desktop\tts voice janitor\janitor-voice
   ```
3. Click **"Select Folder"**

### Step 5: Verify Installation

You should see the extension card with:
- ✅ **Name**: Janitor Voice
- ✅ **Version**: 1.0.0
- ✅ **Description**: "Adds automatic Text-to-Speech voice to character messages on Janitor AI"
- ✅ **Status**: Enabled (blue toggle)
- ✅ **Icon**: Purple gradient microphone icon

### Step 6: Pin the Extension (Optional)

1. Click the **Extensions icon** (puzzle piece) in Chrome toolbar
2. Find **"Janitor Voice"**
3. Click the **pin icon** to keep it visible

---

## 🧪 Testing the Extension

### Test 1: Basic Functionality

1. **Open Janitor AI**
   - Navigate to https://janitorai.com
   - Log in if needed
   - Open any character chat

2. **Verify Panel Appears**
   - Look for the floating control panel in the top-right corner
   - Should see: "🎤 Janitor Voice" header
   - If not visible, reload the page (F5)

3. **Enable Voice**
   - Click the toggle switch "Enable Voice"
   - Status should change to "✓ Voice Active" (green)

4. **Send a Message**
   - Type a message to the character
   - Wait for the character's reply
   - The reply should be **spoken aloud automatically**

### Test 2: Voice Settings

1. **Adjust Speech Rate**
   - Move the "Speech Rate" slider
   - Valid range: 0.5x (slow) to 2x (fast)
   - Send another message to test the new rate

2. **Adjust Pitch**
   - Move the "Pitch" slider
   - Valid range: 0.5 (low) to 2 (high)
   - Send another message to test the new pitch

3. **Change Voice**
   - Open the "Voice" dropdown
   - Select a different voice from the list
   - Send another message to hear the new voice

### Test 3: Panel Controls

1. **Drag Panel**
   - Click and hold the header ("🎤 Janitor Voice")
   - Drag to a new position
   - Release to drop

2. **Minimize Panel**
   - Click the **"−"** button
   - Panel should collapse to just the header
   - Click **"+"** to expand again

3. **Close Panel**
   - Click the **"×"** button
   - Panel should hide
   - Reload page to show it again

### Test 4: Keyboard Shortcut

1. With Janitor AI open, press:
   - **Windows/Linux**: `Ctrl + Shift + V`
   - **Mac**: `Cmd + Shift + V`

2. Voice should toggle on/off
3. Status indicator should update accordingly

### Test 5: Tab Visibility

1. Enable voice and start a conversation
2. Wait for a character reply to start speaking
3. **Switch to another tab** while it's speaking
4. Speech should **pause**
5. **Switch back** to Janitor AI tab
6. Speech should **resume**

### Test 6: Settings Persistence

1. Configure your preferred settings:
   - Enable voice
   - Set rate to 1.2x
   - Set pitch to 1.1
   - Select a specific voice

2. **Reload the page** (F5)

3. Panel should reappear with:
   - ✅ Same enabled/disabled state
   - ✅ Same rate value
   - ✅ Same pitch value
   - ✅ Same selected voice

---

## 🐛 Troubleshooting

### Issue: Extension Not Loading

**Symptoms**: Extension card doesn't appear after clicking "Load unpacked"

**Solutions**:
1. Verify all files are in the correct folder
2. Check `manifest.json` for syntax errors
3. Look for error messages in the extension card
4. Try reloading the extension

### Issue: Panel Not Appearing

**Symptoms**: No floating panel on Janitor AI

**Solutions**:
1. Verify you're on `https://janitorai.com/*` or `https://www.janitorai.com/*`
2. Open DevTools (F12) and check Console for errors
3. Look for messages starting with `[Janitor Voice]`
4. Hard reload: `Ctrl + Shift + R`
5. Check if extension has permissions for the site

### Issue: No Voice Output

**Symptoms**: Panel works but no speech

**Solutions**:
1. Check system volume is not muted
2. Try a different voice from the dropdown
3. Verify speech rate/pitch are in valid ranges
4. Open DevTools Console and look for speech errors
5. Test with a simple page: chrome://extensions/ → Open popup → Should work

### Issue: Messages Not Detected

**Symptoms**: Voice is enabled but character messages aren't spoken

**Solutions**:
1. Check DevTools Console for detection logs
2. Look for `[Janitor Voice] New character message:` entries
3. If not appearing, Janitor AI's HTML structure may have changed
4. May need to update `CONFIG.SELECTORS` in `content.js`

### Issue: Voice Cuts Off

**Symptoms**: Speech stops mid-sentence

**Solutions**:
1. Try lowering the speech rate
2. Check for browser tab switching
3. Verify no other extensions are interfering
4. Look for errors in Console

---

## 🔍 Debugging

### View Console Logs

1. Open Janitor AI
2. Press `F12` to open DevTools
3. Go to **Console** tab
4. Look for messages prefixed with `[Janitor Voice]`

### Common Log Messages

```
[Janitor Voice] Initializing...
[Janitor Voice] Loaded 45 voices
[Janitor Voice] Observing chat container: <main>
[Janitor Voice] Initialized successfully
[Janitor Voice] Loaded successfully
[Janitor Voice] New character message: Hello! How are you?
[Janitor Voice] Voice enabled
[Janitor Voice] Voice disabled
```

### Inspect Extension State

1. Open DevTools Console on Janitor AI
2. Type: `window.janitorVoiceController`
3. Press Enter
4. You should see the controller object
5. Expand to inspect current state

### Check Settings Storage

```javascript
// In DevTools Console
localStorage.getItem('janitor_voice_enabled')
localStorage.getItem('janitor_voice_rate')
localStorage.getItem('janitor_voice_pitch')
localStorage.getItem('janitor_voice_voiceURI')
```

---

## 📝 Manual Testing Checklist

Use this checklist to verify all features:

### Core Features
- [ ] Extension loads without errors
- [ ] Panel appears automatically on Janitor AI
- [ ] Toggle switch enables/disables voice
- [ ] Character messages are detected
- [ ] Character messages are spoken aloud
- [ ] User messages are NOT spoken
- [ ] Multiple messages queue correctly
- [ ] No duplicate speech for same message

### UI Controls
- [ ] Panel is draggable
- [ ] Minimize button works
- [ ] Close button works
- [ ] All sliders are responsive
- [ ] Voice dropdown populates
- [ ] Status indicator updates correctly

### Settings
- [ ] Speech rate adjusts (0.5x - 2x)
- [ ] Pitch adjusts (0.5 - 2)
- [ ] Voice selection works
- [ ] All settings persist on reload

### Advanced
- [ ] Keyboard shortcut toggles voice
- [ ] Speech pauses when tab hidden
- [ ] Speech resumes when tab visible
- [ ] Queue handles rapid messages
- [ ] Stop works when disabled
- [ ] No memory leaks (long session test)

### Popup
- [ ] Extension popup opens
- [ ] Shows correct status on Janitor AI
- [ ] Shows warning on other sites
- [ ] "Open Janitor AI" link works

---

## 🎉 Success Criteria

Your extension is working correctly if:

1. ✅ All files load without errors
2. ✅ Panel appears on Janitor AI automatically
3. ✅ Character messages are spoken automatically when voice is enabled
4. ✅ All controls (sliders, toggle, voice) work smoothly
5. ✅ Settings persist across page reloads
6. ✅ Keyboard shortcut toggles voice
7. ✅ No console errors during normal operation

---

## 🚀 Next Steps

Once everything is working:

1. **Customize Settings**
   - Choose your preferred voice
   - Set comfortable rate and pitch
   - Position panel where you like it

2. **Explore Advanced Features**
   - Test queue handling with rapid messages
   - Try different voices and languages
   - Experiment with rate/pitch combinations

3. **Future Enhancements** (Optional)
   - Swap TTS engine (ElevenLabs, PlayHT, Azure)
   - Add volume control
   - Add voice cloning
   - Add emotion detection
   - Add custom voice profiles

---

## 📚 Additional Resources

- **Chrome Extension Docs**: https://developer.chrome.com/docs/extensions/
- **Web Speech API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
- **Janitor AI**: https://janitorai.com

---

**Happy Testing! 🎤✨**

If you encounter any issues not covered here, check the main README.md or inspect the console logs for detailed error messages.
