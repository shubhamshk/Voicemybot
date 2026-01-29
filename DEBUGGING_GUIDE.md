# Cinematic Voice - Debugging Guide

## 🔍 How to Debug the Cinematic Voice System

The cinematic voice system now has comprehensive debugging built-in to help identify exactly where errors occur.

---

## Quick Start: Enable Debugging

### **Option 1: Quick Debug Test (Recommended)**

1. Open `content.js`
2. Find line ~2721: `// quickDebugTest();`
3. Uncomment it: `quickDebugTest();`
4. Reload the Chrome extension
5. Open Janitor AI website
6. Open DevTools Console (F12)
7. Check the console output

### **Option 2: Debug Your Own Text**

```javascript
// In console or add to content.js:
debugCinematicVoice('Your story text here');
```

---

## Understanding the Debug Output

### **Phase-by-Phase Tracking**

The debugger will show:

```
████████████████████████████████████████████████████████████
█  CINEMATIC VOICE DEBUG SESSION
████████████████████████████████████████████████████████████

Story text: Jack stood up. "Hello!" Emily smiled.

============================================================
🔵 PHASE 1 START: Script Parsing
============================================================
  ↳ Step: Calling parseScript()
  ↳ Step: Validating output
    Data: { blocksCount: 4, hasBlocks: true }
✅ PHASE 1 SUCCESS: Script Parsing
Data: { blocks: 4, sample: { type: 'narration', text: '...' } }
============================================================

============================================================
🔵 PHASE 2 START: Speaker Detection
============================================================
  ↳ Step: Calling extractCharacterNames()
  ↳ Step: Characters extracted
    Data: { count: 2, names: ['Jack', 'Emily'] }
  ↳ Step: Calling detectSpeakers()
  ↳ Step: Speakers detected
    Data: { blocksWithSpeakers: 2 }
✅ PHASE 2 SUCCESS: Speaker Detection
...
```

---

## Error Identification

### **If a Phase Fails**

You'll see:

```
❌ PHASE 3 ERROR: Gender Detection & Voice Casting
Error: Cannot read property 'length' of undefined
Error message: Cannot read property 'length' of undefined
Error stack: Error: Cannot read property 'length' of undefined
    at prepareVoiceCasting (content.js:850)
    at debugCinematicVoice (content.js:2590)
============================================================
```

This tells you:
- ✅ **Which phase failed** (Phase 3)
- ✅ **What the error was** (undefined property)
- ✅ **Where it failed** (line 850 in prepareVoiceCasting)

---

## Debug Summary

At the end, you'll get a summary:

```
============================================================
🔍 CINEMATIC VOICE DEBUG SUMMARY
============================================================
❌ 1 error(s) detected:

1. Phase 3: Gender Detection & Voice Casting
   Message: Cannot read property 'length' of undefined
   Stack: Error: Cannot read property 'length' of undefined...

============================================================
Full log entries: 25
============================================================
```

---

## Common Error Patterns

### **Phase 1 Errors (Parsing)**
```
❌ PHASE 1 ERROR: Script Parsing
Error: parseScript returned empty or null result
```
**Meaning:** Text parsing failed, possibly empty input or regex issue

---

### **Phase 2 Errors (Speaker Detection)**
```
❌ PHASE 2 ERROR: Speaker Detection
Error: extractCharacterNames returned null
```
**Meaning:** Character extraction failed, check DOM or text analysis

---

### **Phase 3 Errors (Voice Casting)**
```
❌ PHASE 3 ERROR: Gender Detection & Voice Casting
Error: prepareVoiceCasting returned invalid result
```
**Meaning:** Voice assignment failed, check voice pools or registry

---

### **Phase 4 Errors (Audio Production)**
```
❌ PHASE 4 ERROR: Audio Production
Error: Producer not generating audio
```
**Meaning:** TTS generation failed, check provider or API keys

---

### **Phase 5 Errors (Audio Consumption)**
```
❌ PHASE 5 ERROR: Audio Consumption
Error: Failed to create AudioConsumer
```
**Meaning:** Playback failed, check queue or audio API

---

## How to Share Debug Info

1. Run `quickDebugTest()` or `debugCinematicVoice(text)`
2. Copy the entire console output
3. Look for the first ❌ error
4. Share:
   - Which phase failed
   - The error message
   - The error stack trace

---

## Additional Debugging

### **Check Specific Function**

```javascript
// Test individual phases:

// Phase 1 only
const blocks = parseScript('Your text');
console.log('Blocks:', blocks);

// Phase 2 only
const chars = extractCharacterNames('Your text');
console.log('Characters:', chars);

// Phase 3 only
const result = prepareVoiceCasting(blocks, chars, 'web_speech');
console.log('Result:', result);
```

---

### **Enable/Disable Debug Logging**

```javascript
// In content.js, find CinematicDebugger class:
this.enabled = true;  // Set to false to reduce logs
```

---

### **Get Error Summary Programmatically**

```javascript
const summary = cinematicDebugger.getErrorSummary();
console.log('Total errors:', summary.totalErrors);
console.log('Last error:', summary.lastError);
```

---

## What Each Phase Should Output

### **Phase 1: Script Parsing**
```
Data: {
  blocks: 4,
  sample: { type: 'narration', text: 'Jack stood up.' }
}
```

### **Phase 2: Speaker Detection**
```
Data: {
  characters: 2,
  dialogueBlocks: 2
}
```

### **Phase 3: Voice Casting**
```
Data: {
  characters: 3,
  voices: ['male_voice_1', 'female_voice_1', 'narrator_voice']
}
```

### **Phase 4: Audio Production**
```
Data: {
  isGenerating: true,
  queueSize: 1
}
```

### **Phase 5: Audio Consumption**
```
Data: {
  totalPlayed: 4
}
```

---

## Troubleshooting Steps

### **Problem: No output at all**
1. Check if `quickDebugTest()` is uncommented
2. Reload extension
3. Check console for JavaScript errors

### **Problem: Phase 1 fails immediately**
1. Check if functions are defined
2. Look for syntax errors
3. Verify text input is not empty

### **Problem: Phase 4 fails (no audio)**
1. Check provider ('web_speech' should work)
2. Verify voices are available
3. Check browser supports Web Speech API

### **Problem: Phase 5 fails (no playback)**
1. Check if queue has items
2. Verify audio context is created
3. Check browser audio permissions

---

## Quick Reference

| Function | Purpose |
|----------|---------|
| `quickDebugTest()` | Run debugging with sample text |
| `debugCinematicVoice(text)` | Debug with your text |
| `cinematicDebugger.printErrorSummary()` | Show error summary |
| `cinematicDebugger.getErrorSummary()` | Get errors programmatically |
| `cinematicDebugger.reset()` | Clear debug logs |

---

## Next Steps After Identifying Error

1. Note which phase failed
2. Check the error message
3. Look at the line number in stack trace
4. Fix the issue in that specific function
5. Re-run debugger to verify fix

---

**Created:** 2026-01-29  
**Last Updated:** 2026-01-29
