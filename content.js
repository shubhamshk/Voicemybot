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
      unrealKey: this.get('unrealKey', CONFIG.DEFAULTS.unrealKey),
      cinematicMode: this.get('cinematicMode', false) // NEW: Cinematic voice mode
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
// SCRIPT PARSING - PHASE 1: NARRATION + DIALOGUE SEPARATION
// ============================================================================

/**
 * Parse raw story text into structured script (narration + dialogue)
 * Dialogue is identified by double quotes "..."
 * Everything else is narration
 * @param {string} rawText - Raw story text
 * @returns {Array<{type: string, text: string}>} Structured script array
 */
function parseScript(rawText) {
  console.log('[Janitor Voice] parseScript() Input:', rawText);

  if (!rawText || !rawText.trim()) {
    return [];
  }

  const script = [];
  let lastIndex = 0;

  // Regex to match text inside double quotes (dialogue)
  const dialogueRegex = /"([^"]*)"/g;
  let match;

  while ((match = dialogueRegex.exec(rawText)) !== null) {
    const dialogueStart = match.index;
    const dialogueEnd = dialogueRegex.lastIndex;
    const dialogueText = match[1]; // Text inside quotes (without the quotes)

    // Add narration before this dialogue (if any)
    if (dialogueStart > lastIndex) {
      const narrationText = rawText.substring(lastIndex, dialogueStart).trim();
      if (narrationText) {
        script.push({ type: 'narration', text: narrationText });
      }
    }

    // Add dialogue
    if (dialogueText.trim()) {
      script.push({ type: 'dialogue', text: dialogueText.trim() });
    }

    lastIndex = dialogueEnd;
  }

  // Add any remaining narration after last dialogue
  if (lastIndex < rawText.length) {
    const narrationText = rawText.substring(lastIndex).trim();
    if (narrationText) {
      script.push({ type: 'narration', text: narrationText });
    }
  }

  console.log('[Janitor Voice] parseScript() Output:', script);
  console.log(`[Janitor Voice] Parsed ${script.length} blocks (${script.filter(b => b.type === 'dialogue').length} dialogue, ${script.filter(b => b.type === 'narration').length} narration)`);

  return script;
}

/**
 * Test suite for parseScript function
 * Run this to verify parsing works correctly
 */
function testParseScript() {
  console.log('\n========================================');
  console.log('TESTING parseScript() FUNCTION');
  console.log('========================================\n');

  // Test 1: Mixed narration and dialogue
  console.log('--- TEST 1: Mixed Narration and Dialogue ---');
  parseScript('Jack stood abruptly, wine sloshing from his glass. "What the hell, dude? You think this is funny?" His voice rose with each word. "I\'m not laughing. This is sick."');

  // Test 2: Dialogue at start
  console.log('\n--- TEST 2: Dialogue at Start ---');
  parseScript('"Hello there!" she said cheerfully. The sun was shining bright.');

  // Test 3: Dialogue at end
  console.log('\n--- TEST 3: Dialogue at End ---');
  parseScript('The room fell silent. Everyone turned to look at him. "We need to talk."');

  // Test 4: Multiple paragraphs
  console.log('\n--- TEST 4: Multiple Paragraphs ---');
  parseScript('The night was cold and dark.\n\n"Are you sure about this?" he whispered.\n\nShe nodded slowly, fear in her eyes.');

  // Test 5: Long narration, no dialogue
  console.log('\n--- TEST 5: Pure Narration ---');
  parseScript('The ancient forest stretched for miles in every direction. Towering trees created a canopy that blocked most of the sunlight. Strange sounds echoed through the undergrowth.');

  // Test 6: Multiple consecutive dialogues
  console.log('\n--- TEST 6: Multiple Dialogues ---');
  parseScript('"Wait!" "Stop!" "Don\'t go!" The voices overlapped in desperation.');

  // Test 7: Empty quotes
  console.log('\n--- TEST 7: Empty Quotes ---');
  parseScript('He opened his mouth. "" Nothing came out. "" He tried again.');

  // Test 8: Complex punctuation
  console.log('\n--- TEST 8: Complex Punctuation ---');
  parseScript('"What... what are you doing?" she stammered. He didn\'t answer. "Please, tell me!"');

  console.log('\n========================================');
  console.log('TEST SUITE COMPLETE');
  console.log('========================================\n');
}

// Uncomment to run tests:
// testParseScript();

// ============================================================================
// SCRIPT PARSING - PHASE 2: SPEAKER DETECTION
// ============================================================================

/**
 * Extract character names dynamically from the page or text
 * Priority 1: Extract from Janitor AI UI (character name elements)
 * Priority 2: Extract from text (capitalized words appearing multiple times)
 * @param {string} [fallbackText] - Optional text to scan for character names
 * @returns {string[]} Array of unique character names
 */
/**
 * Extract character names dynamically from the page or text
 * Priority 1: Extract from Janitor AI UI (character name elements)
 * Priority 2: Extract from text (capitalized words appearing multiple times)
 * @param {string} [fallbackText] - Optional text to scan for character names
 * @returns {string[]} Array of unique character names
 */
/**
 * Extract character names dynamically with STRICT filtering
 * Goals:
 * 1. Clean possessives ("Madison's" -> "Madison")
 * 2. Filter logic words ("Say", "Well", "Oh")
 * 3. Enforce frequency thresholds to reduce noise
 */
function extractCharacterNames(fallbackText = '') {
  console.log('[Janitor Voice] Extracting character names (Strict Mode)...');

  const characterSet = new Set();
  const rawDOMLogs = [];

  // ==========================================================================
  // PART 1: PRIMARY SOURCE (DOM) - Brief check
  // ==========================================================================
  try {
    const candidates = [];
    const elements = document.querySelectorAll('h1, h2, h3, div[class*="Description"], div[class*="Title"], div[class*="Header"]');

    elements.forEach(el => {
      const text = el.textContent.trim();
      if (!text) return;
      if (text.includes(',') && /[A-Z]/.test(text)) {
        const parts = text.split(',').map(p => p.trim());
        // Stricter check for DOM names
        const validNames = parts.filter(p => /^[A-Z][a-zA-Z]+$/.test(p) && p.length > 2);
        if (validNames.length > 0 && validNames.length >= parts.length * 0.5) {
          candidates.push(validNames);
          rawDOMLogs.push(`Found list in <${el.tagName}>: "${text}"`);
        }
      }
    });

    if (candidates.length > 0) {
      const bestList = candidates.reduce((a, b) => a.length > b.length ? a : b);
      bestList.forEach(name => characterSet.add(name));
      console.log('[Janitor Voice] Found character list in DOM:', bestList);
    }

    // Check main header
    const mainHeader = document.querySelector('h1, h2');
    if (mainHeader) {
      const name = mainHeader.textContent.trim();
      // Clean possessive from header too just in case
      const cleanName = name.replace(/'s$/i, '');
      if (/^[A-Z][a-zA-Z]+$/.test(cleanName) && cleanName.length > 2 && cleanName.length < 20) {
        const generics = ['Chat', 'Settings', 'Description', 'Janitor', 'Dashboard', 'Characters'];
        if (!generics.some(g => cleanName.includes(g))) {
          characterSet.add(cleanName);
          rawDOMLogs.push(`Found header name: "${cleanName}"`);
        }
      }
    }
  } catch (e) {
    console.warn('[Janitor Voice] DOM extraction warning:', e);
  }

  // ==========================================================================
  // PART 2: STRICT TEXT ANALYSIS
  // ==========================================================================
  if (fallbackText) {
    console.log('[Janitor Voice] Analyzing text for characters...');

    // 1. Tokenize & Clean
    // Split by non-word chars but keep potential names intact
    // We remove quotes first to avoid "Say" being treated as a name
    const cleanText = fallbackText.replace(/["'”]/g, ' ');
    const words = cleanText.split(/[^a-zA-Z']+/).filter(w => w);

    // 2. Stop words (Expanded List)
    const stopWords = new Set([
      // Pronouns & Articles
      'The', 'A', 'An', 'It', 'He', 'She', 'They', 'His', 'Her', 'Him', 'You', 'I', 'My', 'Your', 'We', 'Us', 'Our', 'That', 'This', 'These', 'Those',
      // Common Starters
      'But', 'And', 'So', 'Or', 'If', 'When', 'While', 'Then', 'As', 'At', 'In', 'On', 'To', 'For', 'With', 'By', 'From',
      // Dialogue/Action Interjections
      'Say', 'Says', 'Said', 'Well', 'Oh', 'Ah', 'Hmm', 'Um', 'Huh', 'Hey', 'Hi', 'Hello', 'Yeah', 'Yes', 'No', 'Ok', 'Okay', 'Right',
      // Misc Common Words
      'Not', 'Just', 'Like', 'Now', 'One', 'Two', 'See', 'Look', 'Go', 'Get', 'Come', 'Do', 'Don', 'Did', 'Can', 'Will', 'Would', 'Could', 'Should',
      'Mr', 'Mrs', 'Ms', 'Dr', 'Sir', 'Lady', 'Miss', 'Madam'
    ]);

    const candidateCounts = {};
    const validCandidates = [];

    words.forEach(word => {
      // A. Basic shape check
      if (word.length < 3) return; // Too short
      if (!/^[A-Z]/.test(word)) return; // Must start with capital
      if (word === word.toUpperCase()) return; // Ignore ALL CAPS (usually shouting)

      // B. Possessive Cleaning ("Madison's" -> "Madison")
      let cleanWord = word;
      if (word.endsWith("'s")) {
        cleanWord = word.slice(0, -2);
      } else if (word.endsWith("s'")) { // plural possessive
        cleanWord = word.slice(0, -2);
      }

      if (cleanWord.length < 3) return; // Re-check length

      // C. Stop Word Filtering
      if (stopWords.has(cleanWord)) return;

      // D. Frequency Counting
      candidateCounts[cleanWord] = (candidateCounts[cleanWord] || 0) + 1;
      validCandidates.push(cleanWord);
    });

    // 3. Frequency Threshold & Selection
    console.log('[Janitor Voice] Candidate Frequencies:', candidateCounts);

    Object.entries(candidateCounts).forEach(([name, count]) => {
      // Rule: Must appear more than once OR be in the DOM list already
      // Exception: If text is very short (< 300 chars), allow count=1
      const isShortText = fallbackText.length < 300;

      if (count >= 2 || (isShortText && count >= 1)) {
        characterSet.add(name);
      }
    });
  }

  // ==========================================================================
  // PART 3: CLEANUP & OUTPUT
  // ==========================================================================
  let finalNames = Array.from(characterSet).sort();

  // Remove known bad names
  const badNames = ['Narrator', 'Voice', 'System', 'Unknown', 'Everyone', 'Someone', 'Anybody', 'Nobody'];
  finalNames = finalNames.filter(n => !badNames.includes(n));

  console.log(`[Janitor Voice] Extracted characters (${finalNames.length}):`, finalNames);
  return finalNames;
}

/**
 * Detect speaker for each dialogue block
 * Uses heuristic analysis of surrounding narration
 * @param {Array<{type: string, text: string}>} structuredScript - Output from parseScript()
 * @param {string[]} characterList - Array of character names
 * @returns {Array<{type: string, text: string, speaker?: string}>} Script with speaker fields
 */
function detectSpeakers(structuredScript, characterList) {
  console.log('\n[Janitor Voice] ========== SPEAKER DETECTION ==========');
  console.log(`[Janitor Voice] Processing ${structuredScript.length} blocks with ${characterList.length} characters`);

  if (!characterList || characterList.length === 0) {
    console.warn('[Janitor Voice] No characters provided, defaulting all to Narrator');
    return structuredScript.map(block => {
      if (block.type === 'dialogue') {
        return { ...block, speaker: 'Narrator' };
      }
      return block;
    });
  }

  let lastSpeaker = null; // Memory for context
  const result = [];

  for (let i = 0; i < structuredScript.length; i++) {
    const block = structuredScript[i];

    if (block.type === 'narration') {
      // Just pass through narration, but scan for names
      result.push(block);
      continue;
    }

    // DIALOGUE BLOCK - Detect speaker
    console.log(`\n--- Dialogue Block ${i + 1} ---`);
    console.log(`DIALOGUE: "${block.text}"`);

    let detectedSpeaker = null;

    // RULE 1: Look backward for character names in recent narration
    let searchRadius = Math.min(i, 3); // Look back up to 3 blocks
    const nearbyText = [];

    for (let j = i - 1; j >= Math.max(0, i - searchRadius); j--) {
      if (structuredScript[j].type === 'narration') {
        nearbyText.unshift(structuredScript[j].text);
      }
    }

    const contextText = nearbyText.join(' ');
    console.log(`Context: "${contextText.substring(0, 100)}..."`);

    // Find character names in context
    const foundNames = [];
    characterList.forEach(name => {
      // Look for the name as a whole word
      const regex = new RegExp(`\\b${name}\\b`, 'gi');
      if (regex.test(contextText)) {
        // Find the last occurrence position
        let lastIndex = -1;
        let match;
        const searchRegex = new RegExp(`\\b${name}\\b`, 'gi');
        while ((match = searchRegex.exec(contextText)) !== null) {
          lastIndex = match.index;
        }
        foundNames.push({ name, index: lastIndex });
      }
    });

    // RULE 2: Use the closest name (highest index = most recent)
    if (foundNames.length > 0) {
      foundNames.sort((a, b) => b.index - a.index);
      detectedSpeaker = foundNames[0].name;
      console.log(`Found ${foundNames.length} name(s) in context:`, foundNames.map(f => f.name));
      console.log(`Using closest: ${detectedSpeaker}`);
    }

    // RULE 3: If no name found, use last speaker (context memory)
    if (!detectedSpeaker && lastSpeaker) {
      detectedSpeaker = lastSpeaker;
      console.log(`No name found, using last speaker: ${detectedSpeaker}`);
    }

    // RULE 4: If still unknown, use Narrator
    if (!detectedSpeaker) {
      detectedSpeaker = 'Narrator';
      console.log(`No context available, using: ${detectedSpeaker}`);
    }

    // Update last speaker memory
    lastSpeaker = detectedSpeaker;

    console.log(`✓ SPEAKER: ${detectedSpeaker}`);

    // Add speaker field to dialogue block
    result.push({
      ...block,
      speaker: detectedSpeaker
    });
  }

  console.log('\n[Janitor Voice] ========== DETECTION COMPLETE ==========\n');

  return result;
}

/**
 * Full pipeline: Parse script and detect speakers
 * Convenience function combining Phase 1 and Phase 2
 * @param {string} rawText - Raw story text
 * @param {string[]} [characterList] - Optional character list (auto-extracted if not provided)
 * @returns {Array<{type: string, text: string, speaker?: string}>} Full annotated script
 */
function parseScriptWithSpeakers(rawText, characterList = null) {
  console.log('\n[Janitor Voice] ========== FULL SCRIPT PIPELINE ==========\n');

  // Phase 1: Parse narration and dialogue
  const structuredScript = parseScript(rawText);

  // Extract characters if not provided
  if (!characterList) {
    characterList = extractCharacterNames(rawText);
  }

  // Phase 2: Detect speakers
  const annotatedScript = detectSpeakers(structuredScript, characterList);

  console.log('\n[Janitor Voice] ========== PIPELINE COMPLETE ==========');
  console.log('Final Script:', annotatedScript);

  return annotatedScript;
}

/**
 * Test suite for Phase 2: Speaker Detection
 */
function testSpeakerDetection() {
  console.log('\n========================================');
  console.log('TESTING SPEAKER DETECTION (PHASE 2)');
  console.log('========================================\n');


  // Test 2: Multiple narration lines before dialogue
  console.log('\n--- TEST 2: Dialogue After Multiple Narration ---');
  const test2 = 'The room was dark and cold. Sarah walked slowly to the window. She peered outside anxiously. "Someone is out there," she whispered.';
  parseScriptWithSpeakers(test2, ['Sarah', 'David']);

  // Test 3: Multiple character names nearby
  console.log('\n--- TEST 3: Multiple Names Nearby ---');
  const test3 = 'Michael grabbed Tom by the shoulder. Tom turned around quickly. "What do you want?" he snapped.';
  parseScriptWithSpeakers(test3, ['Michael', 'Tom']);

  // Test 4: Dialogue with no nearby name
  console.log('\n--- TEST 4: No Nearby Name ---');
  const test4 = 'The wind howled outside. Rain poured down. "This is terrible weather."';
  parseScriptWithSpeakers(test4, ['Alice', 'Bob']);

  // Test 5: Back-to-back dialogue
  console.log('\n--- TEST 5: Back-to-Back Dialogue ---');
  const test5 = 'Lisa entered the room. "Hey everyone!" "Hi Lisa!" "How are you?" "Great, thanks!"';
  parseScriptWithSpeakers(test5, ['Lisa', 'Mark']);

  // Test 6: No character list provided (auto-extract)
  console.log('\n--- TEST 6: Auto Character Extraction ---');
  const test6 = 'Amanda walked into the café. "Hi there," she said to the barista. Marcus looked up from his book. "Amanda! Long time no see!" Amanda smiled. "Yeah, it has been a while."';
  parseScriptWithSpeakers(test6); // No character list - will auto-extract

  console.log('\n========================================');
  console.log('SPEAKER DETECTION TESTS COMPLETE');
  console.log('========================================\n');
}

// Uncomment to run Phase 2 tests:
// testSpeakerDetection();

// ============================================================================
// SCRIPT PARSING - PHASE 3: GENDER DETECTION & VOICE CASTING
// ============================================================================

/**
 * Common name datasets for gender heuristics
 * Limited dataset for offline gender detection
 */
/**
 * Common name datasets for gender heuristics
 * Expanded dataset for robust offline detection
 */
const NAME_DATASETS = {
  male: [
    'Jack', 'John', 'James', 'Michael', 'David', 'Robert', 'William', 'Richard', 'Thomas', 'Daniel',
    'Matthew', 'Mark', 'Paul', 'Steven', 'Andrew', 'Kenneth', 'Joshua', 'Kevin', 'Brian', 'George',
    'Edward', 'Ronald', 'Timothy', 'Jason', 'Jeffrey', 'Ryan', 'Jacob', 'Nicholas', 'Eric', 'Stephen',
    'Jonathan', 'Larry', 'Justin', 'Scott', 'Brandon', 'Benjamin', 'Samuel', 'Raymond', 'Gregory', 'Frank',
    'Alexander', 'Patrick', 'Peter', 'Harold', 'Douglas', 'Henry', 'Carl', 'Arthur', 'Tom', 'Marcus',
    'Luke', 'Nathan', 'Aaron', 'Adam', 'Isaac', 'Tyler', 'Kyle', 'Walter', 'Mike', 'Alex', 'Chris',
    'Joe', 'Ethan', 'Noah', 'Liam', 'Mason', 'Logan', 'Lucas', 'Jackson', 'Aiden', 'Elijay', 'Caleb',
    'Gabriel', 'Hunter', 'Connor', 'Dylan', 'Landon', 'Evan', 'Gavin', 'Cole', 'Austin', 'Derek'
  ],
  female: [
    'Emily', 'Sarah', 'Jessica', 'Ashley', 'Jennifer', 'Amanda', 'Melissa', 'Michelle', 'Stephanie',
    'Nicole', 'Elizabeth', 'Rebecca', 'Laura', 'Cynthia', 'Amy', 'Kathleen', 'Angela', 'Shirley', 'Anna',
    'Brenda', 'Pamela', 'Samantha', 'Katherine', 'Christine', 'Deborah', 'Rachel', 'Carolyn', 'Janet',
    'Catherine', 'Maria', 'Heather', 'Diane', 'Ruth', 'Julie', 'Olivia', 'Emma', 'Ava', 'Sophia',
    'Isabella', 'Mia', 'Charlotte', 'Amelia', 'Harper', 'Evelyn', 'Abigail', 'Madison', 'Ella', 'Scarlett',
    'Grace', 'Chloe', 'Victoria', 'Riley', 'Aria', 'Lily', 'Aubrey', 'Zoey', 'Hannah', 'Lisa', 'Mary',
    'Susan', 'Margaret', 'Dorothy', 'Sandra', 'Kimberly', 'Naomi', 'Hana', 'Alice', 'Megan', 'Sophie',
    'Lucy', 'Ellie', 'Layla', 'Nora', 'Zoe', 'Mila', 'Luna', 'Camila', 'Gianna', 'Penelope', 'Hazel',
    'Violet', 'Stella', 'Aurora', 'Natalie', 'Leah', 'Bella', 'Claire', 'Skylar', 'Lucy', 'Anna'
  ],
  unisex: [
    'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Avery', 'Quinn', 'Sage', 'River',
    'Dakota', 'Phoenix', 'Skylar', 'Cameron', 'Rowan', 'Charlie', 'Jamie', 'Reese', 'Hayden',
    'Peyton', 'Emerson', 'Finley', 'Sawyer', 'Parker', 'Kai', 'Eden', 'Remi', 'Rory'
  ]
};

/**
 * Detect gender for a character name
 * Priority: UI extraction > Name heuristic > Pronoun analysis > Unknown
 * @param {string} name - Character name
 * @param {string} [contextText] - surrounding text for pronoun analysis
 * @returns {string} Gender: "male", "female", "neutral", or "unknown"
 */
function detectGender(name, contextText = '') {
  // Special case: Narrator is always neutral
  if (name === 'Narrator') return 'neutral';

  const lowerName = name.toLowerCase();

  // PRIORITY 1: Try to extract from UI (Janitor AI profile)
  // Only works if we are on the page
  if (typeof document !== 'undefined') {
    try {
      const bioSelectors = ['[class*="bio"]', '[class*="description"]', '[class*="profile"]', '[class*="character-info"]'];
      for (const selector of bioSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const text = el.textContent.toLowerCase();
          // Precise whole-word check if possible, or context check
          if (text.includes(` ${lowerName} is a male`) || text.includes(` ${lowerName} is a man`)) return 'male';
          if (text.includes(` ${lowerName} is a female`) || text.includes(` ${lowerName} is a woman`)) return 'female';
        }
      }
    } catch (e) { /* ignore */ }
  }

  // PRIORITY 2: Name-based heuristic (Exact Match)
  if (NAME_DATASETS.male.includes(name)) return 'male';
  if (NAME_DATASETS.female.includes(name)) return 'female';
  if (NAME_DATASETS.unisex.includes(name)) return 'neutral';

  // PRIORITY 3: Pronoun Analysis from Story Text
  if (contextText) {
    const textLower = contextText.toLowerCase();
    // Simple window scan: look for name, then check immediate vicinity for pronouns
    // Heuristic: Count pronouns in text segments that mention the name

    // Split into sentences or chunks to localize context
    const chunks = textLower.split(/[.!?\n]+/);
    let heScore = 0;
    let sheScore = 0;

    chunks.forEach(chunk => {
      if (chunk.includes(lowerName)) {
        // This sentence mentions the character. Check pronouns.
        const words = chunk.split(/\s+/);
        words.forEach(w => {
          if (['he', 'him', 'his', 'himself'].includes(w)) heScore++;
          if (['she', 'her', 'hers', 'herself'].includes(w)) sheScore++;
        });
      }
    });

    if (heScore > sheScore) return 'male';
    if (sheScore > heScore) return 'female';
  }

  // PRIORITY 4: Fallback Heuristics
  // Ends in 'a' is often female (but not always, e.g. Joshua, Luca)
  if (lowerName.endsWith('a') && !['joshua', 'luca', 'ezra', 'elija'].includes(lowerName)) return 'female';

  return 'unknown';
}

/**
 * Build character registry with gender detection
 * @param {string[]} characterList - Array of character names
 * @param {string} [contextText] - Full story text for pronoun inference
 * @returns {Object} Character registry with gender info
 */
function buildCharacterRegistry(characterList, contextText = '') {
  console.log('\n[Janitor Voice] ========== BUILDING CHARACTER REGISTRY ==========');
  console.log(`[Janitor Voice] Processing ${characterList.length} characters`);

  const registry = {};

  // Always include Narrator
  if (!characterList.includes('Narrator')) {
    characterList.push('Narrator');
  }

  characterList.forEach(name => {
    const gender = detectGender(name, contextText);
    registry[name] = {
      gender: gender,
      voice: null
    };
    console.log(`[Janitor Voice] ${name}: gender = ${gender}`);
  });

  console.log('[Janitor Voice] Character Registry:', registry);
  console.log('[Janitor Voice] ========== REGISTRY COMPLETE ==========\n');

  return registry;
}

/**
 * Get available voice pools based on current TTS provider
 * @param {string} provider - Current TTS provider
 * @returns {Object} Voice pools by gender
 */
function getVoicePools(provider = 'web_speech') {
  // For now, return generic voice identifiers
  // In Phase 4, these will map to actual TTS voices

  const pools = {
    male: ['male_voice_1', 'male_voice_2', 'male_voice_3'],
    female: ['female_voice_1', 'female_voice_2', 'female_voice_3'],
    neutral: ['neutral_voice_1', 'neutral_voice_2'],
    narrator: 'narrator_voice',
    fallback: 'default_voice'
  };

  console.log('[Janitor Voice] Voice Pools:', pools);
  return pools;
}

/**
 * Assign voices to characters in the registry
 * @param {Object} characterRegistry - Character registry with gender info
 * @param {Object} voicePools - Available voice pools
 * @returns {Object} Updated registry with voice assignments
 */
/**
 * Assign voices to characters in the registry
 * @param {Object} characterRegistry - Character registry with gender info
 * @param {Object} voicePools - Available voice pools
 * @param {string} [preferredVoiceURI] - User selected voice URI for Narrator
 * @returns {Object} Updated registry with voice assignments
 */
function assignVoices(characterRegistry, voicePools, preferredVoiceURI = null) {
  console.log('\n[Janitor Voice] ========== VOICE ASSIGNMENT ==========');
  if (preferredVoiceURI) console.log(`[Janitor Voice] Preferred Voice: ${preferredVoiceURI}`);

  const maleIndex = { current: 0 };
  const femaleIndex = { current: 0 };
  const neutralIndex = { current: 0 };

  Object.keys(characterRegistry).forEach(name => {
    const char = characterRegistry[name];

    // Narrator: Use preferred voice if set (UI Override), else default narrator pool
    if (name === 'Narrator') {
      char.voice = preferredVoiceURI || voicePools.narrator;
      console.log(`[Janitor Voice] ${name} → ${char.voice} (narrator/override)`);
      return;
    }

    // Assign based on gender
    switch (char.gender) {
      case 'male':
        char.voice = voicePools.male[maleIndex.current % voicePools.male.length];
        maleIndex.current++;
        console.log(`[Janitor Voice] ${name} → ${char.voice} (male #${maleIndex.current})`);
        break;

      case 'female':
        char.voice = voicePools.female[femaleIndex.current % voicePools.female.length];
        femaleIndex.current++;
        console.log(`[Janitor Voice] ${name} → ${char.voice} (female #${femaleIndex.current})`);
        break;

      case 'neutral':
        char.voice = voicePools.neutral[neutralIndex.current % voicePools.neutral.length];
        neutralIndex.current++;
        console.log(`[Janitor Voice] ${name} → ${char.voice} (neutral #${neutralIndex.current})`);
        break;

      default: // unknown
        // Rule 3: Last Resort - Alternate voices so they don't all sound the same
        // Even if gender is unknown, we assign a voice from the male/female pools in round-robin fashion
        {
          const inferredGender = (neutralIndex.current % 2 === 0) ? 'male' : 'female';

          if (inferredGender === 'male') {
            char.voice = voicePools.male[maleIndex.current % voicePools.male.length];
            maleIndex.current++;
            console.log(`[Janitor Voice] ${name} (unknown) → ${char.voice} (male fallback)`);
          } else {
            char.voice = voicePools.female[femaleIndex.current % voicePools.female.length];
            femaleIndex.current++;
            console.log(`[Janitor Voice] ${name} (unknown) → ${char.voice} (female fallback)`);
          }
          // Increment neutral index just to keep track of alternating state
          neutralIndex.current++;
          // We update the gender in registry so subsequent logic knows what kind of voice it is
          char.gender = inferredGender + '?';
        }
        break;
    }
  });

  console.log('[Janitor Voice] Final Character Registry:', characterRegistry);
  console.log('[Janitor Voice] ========== ASSIGNMENT COMPLETE ==========\n');

  return characterRegistry;
}

/**
 * Attach voice metadata to script blocks
 * @param {Array} structuredScript - Script with speaker info (from Phase 2)
 * @param {Object} characterRegistry - Character registry with voice assignments
 * @returns {Array} Script with voice fields added
 */
function attachVoices(structuredScript, characterRegistry) {
  console.log('\n[Janitor Voice] ========== ATTACHING VOICES TO SCRIPT ==========');
  console.log(`[Janitor Voice] Processing ${structuredScript.length} blocks`);

  const result = structuredScript.map((block, index) => {
    if (block.type === 'narration') {
      // Narration uses narrator voice
      const voice = characterRegistry['Narrator']?.voice || 'narrator_voice';
      console.log(`Block ${index + 1} [NARRATION]: voice = ${voice}`);
      return {
        ...block,
        voice: voice
      };
    } else if (block.type === 'dialogue') {
      // Dialogue uses speaker's assigned voice
      const speaker = block.speaker || 'Narrator';
      const voice = characterRegistry[speaker]?.voice || 'default_voice';
      const gender = characterRegistry[speaker]?.gender || 'unknown';
      console.log(`Block ${index + 1} [DIALOGUE]: speaker = ${speaker}, gender = ${gender}, voice = ${voice}`);
      return {
        ...block,
        voice: voice
      };
    }
    return block;
  });

  console.log('[Janitor Voice] ========== VOICE ATTACHMENT COMPLETE ==========\n');
  return result;
}

/**
 * Full Phase 3 pipeline: Gender detection and voice casting
 * @param {Array} structuredScript - Script from Phase 2 (with speakers)
 * @param {string[]} characterList - List of character names
 * @param {string} contextText - Full story text for pronoun inference
 * @param {string} provider - TTS provider (for voice pool selection)
 * @param {string} [preferredVoiceURI] - User selected voice URI
 * @returns {Object} { script: Array, registry: Object }
 */
function prepareVoiceCasting(structuredScript, characterList, contextText = '', provider = 'web_speech', preferredVoiceURI = null) {
  console.log('\n[Janitor Voice] ========== PHASE 3: VOICE CASTING PREPARATION ==========\n');

  // Step 1: Build character registry with gender detection
  const characterRegistry = buildCharacterRegistry(characterList, contextText);

  // Step 2: Get voice pools
  const voicePools = getVoicePools(provider);

  // Step 3: Assign voices to characters
  assignVoices(characterRegistry, voicePools, preferredVoiceURI);

  // Step 4: Attach voice metadata to script blocks
  const scriptWithVoices = attachVoices(structuredScript, characterRegistry);

  console.log('[Janitor Voice] ========== PHASE 3 COMPLETE ==========');
  console.log('Script with Voices:', scriptWithVoices);
  console.log('Character Registry:', characterRegistry);

  return {
    script: scriptWithVoices,
    registry: characterRegistry
  };
}

/**
 * Combined pipeline: Phase 1 + 2 + 3
 * Parse text, detect speakers, assign voices
 * @param {string} rawText - Raw story text
 * @param {string[]} [characterList] - Optional character list
 * @param {string} [provider] - TTS provider
 * @param {string} [preferredVoiceURI] - Optional preferred voice for narrator
 * @returns {Object} { script: Array, registry: Object }
 */
function parseScriptComplete(rawText, characterList = null, provider = 'web_speech', preferredVoiceURI = null) {
  console.log('\n[Janitor Voice] ========== FULL PIPELINE (PHASE 1+2+3) ==========\n');

  // Phase 1: Parse narration and dialogue
  const structuredScript = parseScript(rawText);

  // Extract characters if not provided
  if (!characterList) {
    characterList = extractCharacterNames(rawText);
  }

  // Phase 2: Detect speakers
  const scriptWithSpeakers = detectSpeakers(structuredScript, characterList);

  // Phase 3: Gender detection and voice casting
  // Pass rawText for pronoun analysis context
  const result = prepareVoiceCasting(scriptWithSpeakers, characterList, rawText, provider, preferredVoiceURI);

  console.log('[Janitor Voice] Pipeline Result:', result);
  console.log('\n[Janitor Voice] ========== FULL PIPELINE COMPLETE ==========');
  console.log('Ready for Phase 4 (Audio Generation)');

  return result;
}

/**
 * Test suite for Phase 3: Voice Casting
 */
function testVoiceCasting() {
  console.log('\n========================================');
  console.log('TESTING VOICE CASTING (PHASE 3)');
  console.log('========================================\n');

  // Test 1: Simple male/female characters
  console.log('--- TEST 1: Simple Male/Female Characters ---');
  const test1 = 'Jack stood up. "Hello everyone!" Emily smiled. "Hi Jack!"';
  parseScriptComplete(test1, ['Jack', 'Emily']);

  // Test 2: Mixed gender characters with narrator
  console.log('\n--- TEST 2: Mixed Characters ---');
  const test2 = 'The sun was setting. Sarah walked in. "Good evening." Tom nodded. "Evening."';
  parseScriptComplete(test2, ['Sarah', 'Tom']);

  // Test 3: Unknown gender character
  console.log('\n--- TEST 3: Unknown Gender ---');
  const test3 = 'Zephyr appeared. "I have returned." The crowd gasped.';
  parseScriptComplete(test3, ['Zephyr']);

  // Test 4: Unisex name
  console.log('\n--- TEST 4: Unisex Name ---');
  const test4 = 'Alex entered. "Hey everyone!" Jordan waved. "Welcome back!"';
  parseScriptComplete(test4, ['Alex', 'Jordan']);

  // Test 5: Auto-extraction with full pipeline
  console.log('\n--- TEST 5: Full Auto Pipeline ---');
  const test5 = 'Amanda sat down. "This is nice," she said softly. Marcus agreed. "Very peaceful." Amanda nodded.';
  parseScriptComplete(test5); // Auto-extract everything

  console.log('\n========================================');
  console.log('VOICE CASTING TESTS COMPLETE');
  console.log('========================================\n');
}

// Uncomment to run Phase 3 tests:
// testVoiceCasting();

// ============================================================================
// SCRIPT PARSING - PHASE 4: STREAMING AUDIO PRODUCER
// ============================================================================

/**
 * Audio Producer - Streaming TTS generation with queue
 * Generates audio chunks from script blocks and pushes to queue in real-time
 */
class AudioProducer {
  constructor(provider = 'web_speech') {
    this.provider = provider;
    this.audioQueue = [];
    this.isGenerating = false;
    this.generatedCount = 0;
    this.totalBlocks = 0;
    this.currentBlock = 0;
    this.onProgress = null; // Callback for progress updates
    this.onComplete = null; // Callback when all generation done
    this.onError = null; // Callback for errors

    // Pre-load Web Speech voices
    if (provider === 'web_speech') {
      const synth = window.speechSynthesis;
      const voices = synth.getVoices(); // Trigger loading
      console.log('[AudioProducer] Pre-loaded', voices.length, 'voices');
    }

    // Voice Buckets Cache
    this.voiceBuckets = {
      male: [],
      female: [],
      initialized: false
    };
  }

  /**
   * Sort available browser voices into Gender Buckets
   * @private
   */
  _categorizeVoices() {
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();

    if (voices.length === 0) return; // Not loaded yet

    // Reset buckets
    this.voiceBuckets.male = [];
    this.voiceBuckets.female = [];

    const priorityFemale = [];
    const priorityMale = [];
    const otherFemale = [];
    const otherMale = [];

    voices.forEach(v => {
      const name = v.name;
      const lowerName = name.toLowerCase();

      // Specific User Requests for Female Voices
      // 1. Google US English
      // 2. Google UK English Female
      // 3. Microsoft Zira
      if (name === 'Google US English' || name === 'Google UK English Female' || name.includes('Microsoft Zira')) {
        priorityFemale.push(v);
        return;
      }

      // Regex Matchers
      // Female: Zira, Samantha, Victoria, Google UK Female, etc.
      if (/Zira|Samantha|Victoria|Google UK English Female|Google US English|Female|Susan|Hazel|Heera|Ravi/i.test(name) && !/Male/i.test(name)) {
        otherFemale.push(v);
      }
      // Male: David, Alex, Mark, Daniel, George, Microsoft, etc.
      else if (/David|Alex|Mark|Daniel|George|Stefan|Paul|James|Microsoft|Male/i.test(name)) {
        otherMale.push(v);
      }
    });

    // Combine with priority voices first
    // Sort priority female to match requested order: US -> UK -> Zira
    priorityFemale.sort((a, b) => {
      const order = ['Google US English', 'Google UK English Female', 'Microsoft Zira'];
      const aIndex = order.findIndex(p => a.name.includes(p));
      const bIndex = order.findIndex(p => b.name.includes(p));
      return aIndex - bIndex;
    });

    this.voiceBuckets.female = [...priorityFemale, ...otherFemale];
    this.voiceBuckets.male = [...priorityMale, ...otherMale];

    this.voiceBuckets.initialized = true;
    console.log(`[AudioProducer] Categorized Voices: ${this.voiceBuckets.male.length} Male, ${this.voiceBuckets.female.length} Female`);
    console.log('[AudioProducer] Priority Female:', priorityFemale.map(v => v.name));
  }

  /**
   * Map generic voice ID to actual provider voice
   * @param {string} voiceId - Generic voice ID from Phase 3
   * @param {string} provider - TTS provider
   * @returns {string|null} Actual voice identifier for provider
   */
  mapVoiceToProvider(voiceId, provider) {
    if (provider === 'web_speech') {
      // 1. Ensure buckets are ready
      if (!this.voiceBuckets.initialized || this.voiceBuckets.male.length === 0) {
        this._categorizeVoices();
      }

      // 2. Parse ID (e.g. "female_voice_2" -> type="female", index=1)
      let type = 'male';
      let index = 0;

      if (voiceId.includes('female')) type = 'female';
      else if (voiceId.includes('male')) type = 'male';
      else if (voiceId.includes('narrator')) type = 'male'; // Narrator defaults to male
      else if (voiceId.includes('neutral')) type = 'female';

      // Extract index if present
      const match = voiceId.match(/_(\d+)$/);
      if (match) {
        index = parseInt(match[1]) - 1; // 1-based to 0-based
      }

      // 3. Select from Bucket
      const bucket = this.voiceBuckets[type];
      let selectedVoice = null;

      if (bucket && bucket.length > 0) {
        // Wrap around if index exceeds available voices
        selectedVoice = bucket[index % bucket.length];
      } else {
        // Fallback to other bucket
        const otherBucket = type === 'male' ? this.voiceBuckets.female : this.voiceBuckets.male;
        if (otherBucket && otherBucket.length > 0) {
          selectedVoice = otherBucket[0];
        }
      }

      if (selectedVoice) {
        console.log(`[AudioProducer] Mapping ${voiceId} -> ${selectedVoice.name}`);
        return selectedVoice.voiceURI;
      }

      // Ultimate fallback
      return null;
    }

    // For premium providers (ElevenLabs, Unreal Speech)
    // We'll use their default voices for now
    return null; // Null means use provider default
  }

  /**
   * Generate TTS audio for a single text block
   * Routes to appropriate provider based on settings
   * @param {string} text - Text to convert
   * @param {string} voiceId - Generic voice ID
   * @returns {Promise<AudioBuffer|Blob>} Generated audio
   */
  async generateTTS(text, voiceId) {
    console.log(`[AudioProducer] Generating TTS: "${text.substring(0, 50)}..." with voice: ${voiceId}`);

    // Map generic voice to provider-specific voice
    const providerVoice = this.mapVoiceToProvider(voiceId, this.provider);

    // Route to appropriate TTS engine
    // We'll use the existing TTS engines but call them directly

    if (this.provider === 'web_speech') {
      return this.generateWebSpeech(text, providerVoice);
    } else if (this.provider === 'eleven_labs') {
      return this.generateElevenLabs(text, providerVoice);
    } else if (this.provider === 'unreal_speech') {
      return this.generateUnrealSpeech(text, providerVoice);
    } else {
      throw new Error(`Unknown provider: ${this.provider}`);
    }
  }

  /**
   * Generate audio using Web Speech API
   * Returns a synthetic AudioBuffer-like object
   */
  async generateWebSpeech(text, voiceURI) {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);

    // Get voices (they should be loaded by now)
    const voices = synth.getVoices();

    console.log('[AudioProducer] Available voices:', voices.length);
    console.log('[AudioProducer] Looking for voiceURI:', voiceURI);

    if (voiceURI && voices.length > 0) {
      const voice = voices.find(v => v.voiceURI === voiceURI);
      if (voice) {
        utterance.voice = voice;
        console.log('[AudioProducer] ✓ Selected voice:', voice.name, '(', voice.lang, ')');
      } else {
        console.log('[AudioProducer] ⚠ Voice not found:', voiceURI);
        console.log('[AudioProducer] Available voices:', voices.map(v => v.name).join(', '));
      }
    } else {
      console.log('[AudioProducer] Using default voice');
    }

    // Return utterance immediately (don't wait for speech)
    return {
      type: 'web_speech_utterance',
      utterance: utterance,
      text: text
    };
  }

  /**
   * Generate audio using ElevenLabs API
   * Note: Requires API key from settings
   */
  async generateElevenLabs(text, voiceId) {
    // Get API key from storage
    const apiKey = StorageManager.get('elevenLabsKey');
    if (!apiKey) {
      throw new Error('ElevenLabs API key not configured');
    }

    // Use default voice if not specified
    const actualVoiceId = voiceId || '21m00Tcm4TlvDq8ikWAM'; // Rachel
    const modelId = 'eleven_turbo_v2_5';

    console.log(`[AudioProducer] ElevenLabs: Generating with voice ${actualVoiceId}`);

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${actualVoiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: text,
        model_id: modelId,
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API Error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    console.log(`[AudioProducer] ElevenLabs: Received ${arrayBuffer.byteLength} bytes`);

    // Decode to AudioBuffer for consistent format
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    return {
      type: 'audio_buffer',
      audioBuffer: audioBuffer,
      text: text
    };
  }

  /**
   * Generate audio using Unreal Speech API
   * Note: Requires API key from settings
   */
  async generateUnrealSpeech(text, voiceId) {
    // Get API key from storage
    const apiKey = StorageManager.get('unrealKey');
    if (!apiKey) {
      throw new Error('Unreal Speech API key not configured');
    }

    // Use default voice if not specified
    const actualVoiceId = voiceId || 'Scarlett';

    console.log(`[AudioProducer] Unreal Speech: Generating with voice ${actualVoiceId}`);

    const response = await fetch('https://api.v6.unrealspeech.com/stream', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        Text: text,
        VoiceId: actualVoiceId,
        Bitrate: '192k',
        Speed: '0',
        Pitch: '1.0',
        Codec: 'libmp3lame'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Unreal Speech API Error (${response.status}): ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength === 0) {
      throw new Error('Unreal Speech returned empty audio');
    }

    console.log(`[AudioProducer] Unreal Speech: Received ${arrayBuffer.byteLength} bytes`);

    // Decode to AudioBuffer
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    return {
      type: 'audio_buffer',
      audioBuffer: audioBuffer,
      text: text
    };
  }

  /**
   * Process a single script block (with chunking support)
   * @param {Object} block - Script block from Phase 3
   * @param {number} blockIndex - Index of block in script
   */
  async processBlock(block, blockIndex) {
    console.log(`\n[AudioProducer] Processing block ${blockIndex + 1}: ${block.type}`);

    // Split text if needed (using existing smartSplit function)
    const chunks = smartSplit(block.text, 900);
    console.log(`[AudioProducer] Split into ${chunks.length} chunk(s)`);

    // Generate audio for each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const chunkNum = i + 1;
      const totalChunks = chunks.length;

      try {
        console.log(`[AudioProducer] Generating chunk ${chunkNum}/${totalChunks}: "${chunkText.substring(0, 30)}..."`);

        // Generate TTS
        const audioData = await this.generateTTS(chunkText, block.voice);

        // Push to queue
        this.audioQueue.push({
          audio: audioData,
          voice: block.voice,
          text: chunkText,
          speaker: block.speaker || 'Narrator',
          type: block.type,
          blockIndex: blockIndex,
          chunkIndex: i,
          totalChunks: totalChunks
        });

        this.generatedCount++;

        console.log(`[AudioProducer] ✓ Chunk ${chunkNum}/${totalChunks} ready. Queue size: ${this.audioQueue.length}`);

        // Progress callback
        if (this.onProgress) {
          this.onProgress({
            current: this.currentBlock + 1,
            total: this.totalBlocks,
            generatedAudioChunks: this.generatedCount,
            queueSize: this.audioQueue.length
          });
        }

      } catch (error) {
        console.error(`[AudioProducer] Error generating chunk ${chunkNum}/${totalChunks}:`, error);

        // Error callback
        if (this.onError) {
          this.onError({
            block: block,
            chunkIndex: i,
            error: error
          });
        }

        // Continue with next chunk (don't fail entire block)
      }
    }

    this.currentBlock++;
  }

  /**
   * Start streaming audio generation for entire script
   * @param {Array} script - Script blocks from Phase 3
   * @returns {Promise<void>}
   */
  async generateScript(script) {
    console.log('\n[AudioProducer] ========== STARTING STREAMING GENERATION ==========');
    console.log(`[AudioProducer] Provider: ${this.provider}`);
    console.log(`[AudioProducer] Total blocks: ${script.length}`);

    this.audioQueue = [];
    this.isGenerating = true;
    this.generatedCount = 0;
    this.totalBlocks = script.length;
    this.currentBlock = 0;

    try {
      // Process blocks sequentially (but push to queue as they complete)
      for (let i = 0; i < script.length; i++) {
        await this.processBlock(script[i], i);
      }

      console.log('\n[AudioProducer] ========== GENERATION COMPLETE ==========');
      console.log(`[AudioProducer] Generated ${this.generatedCount} audio chunk(s)`);
      console.log(`[AudioProducer] Queue size: ${this.audioQueue.length}`);

      this.isGenerating = false;

      // Complete callback
      if (this.onComplete) {
        this.onComplete({
          totalChunks: this.generatedCount,
          queueSize: this.audioQueue.length
        });
      }

    } catch (error) {
      console.error('[AudioProducer] Fatal error during generation:', error);
      this.isGenerating = false;
      throw error;
    }
  }

  /**
   * Get current queue
   * Safe to call while generation is in progress
   * @returns {Array} Current audio queue
   */
  getQueue() {
    return this.audioQueue;
  }

  /**
   * Get generation state
   * @returns {Object} State information
   */
  getState() {
    return {
      isGenerating: this.isGenerating,
      generatedCount: this.generatedCount,
      totalBlocks: this.totalBlocks,
      currentBlock: this.currentBlock,
      queueSize: this.audioQueue.length
    };
  }

  /**
   * Clear the queue and stop generation
   */
  stop() {
    console.log('[AudioProducer] Stopping generation');
    this.isGenerating = false;
    this.audioQueue = [];
    this.generatedCount = 0;
    this.currentBlock = 0;
  }
}

/**
 * Test Phase 4: Audio Producer
 * Note: This will actually generate audio and may consume API credits
 */
async function testAudioProducer() {
  console.log('\n========================================');
  console.log('TESTING AUDIO PRODUCER (PHASE 4)');
  console.log('========================================\n');

  // Test 1: Simple script with Web Speech API
  console.log('--- TEST 1: Web Speech Audio Generation ---');

  const testText = 'Jack stood up. "Hello everyone!" Emily smiled. "Hi Jack!"';
  const result = parseScriptComplete(testText, ['Jack', 'Emily'], 'web_speech');

  console.log('Script to generate:', result.script);

  const producer = new AudioProducer('web_speech');

  producer.onProgress = (progress) => {
    console.log(`[Progress] Block ${progress.current}/${progress.total}, Queue: ${progress.queueSize}`);
  };

  producer.onComplete = (result) => {
    console.log(`[Complete] Generated ${result.totalChunks} chunks`);
  };

  producer.onError = (error) => {
    console.error('[Error]', error);
  };

  try {
    await producer.generateScript(result.script);
    console.log('Final Queue:', producer.getQueue());
    console.log('Final State:', producer.getState());
  } catch (e) {
    console.error('Test failed:', e);
  }

  console.log('\n========================================');
  console.log('AUDIO PRODUCER TEST COMPLETE');
  console.log('========================================\n');
}

// Uncomment to run Phase 4 tests (WARNING: May consume API credits):
// testAudioProducer();

// ============================================================================
// SCRIPT PARSING - PHASE 5: STREAMING AUDIO CONSUMER (PLAYER)
// ============================================================================

/**
 * Audio Consumer - Streaming playback of queued audio
 * Consumes audioQueue from AudioProducer and plays chunks sequentially
 */
class AudioConsumer {
  constructor(producer) {
    this.producer = producer;
    this.isPlaying = false;
    this.currentIndex = 0;
    this.isStopped = false;
    this.currentAudioSource = null; // Web Audio API source
    this.audioContext = null; // Web Audio API context

    // Callbacks
    this.onPlayStart = null;
    this.onPlayEnd = null;
    this.onChunkStart = null;
    this.onChunkEnd = null;
    this.onProgress = null;
    this.onError = null;
  }

  /**
   * Play a single audio chunk
   * Handles both Web Speech utterances and AudioBuffers
   * @param {Object} queueItem - Item from audioQueue
   * @returns {Promise<void>}
   */
  async playChunk(queueItem) {
    console.log(`\n[AudioConsumer] Playing chunk ${this.currentIndex + 1}`);
    console.log(`[AudioConsumer] Type: ${queueItem.type}, Speaker: ${queueItem.speaker}`);
    console.log(`[AudioConsumer] Text: "${queueItem.text.substring(0, 50)}..."`);

    // Callback: chunk start
    if (this.onChunkStart) {
      this.onChunkStart({
        index: this.currentIndex,
        text: queueItem.text,
        speaker: queueItem.speaker,
        type: queueItem.type
      });
    }

    const audioData = queueItem.audio;

    try {
      if (audioData.type === 'web_speech_utterance') {
        // Play using Web Speech API
        await this.playWebSpeech(audioData.utterance);
      } else if (audioData.type === 'audio_buffer') {
        // Play using Web Audio API
        await this.playAudioBuffer(audioData.audioBuffer);
      } else {
        throw new Error(`Unknown audio type: ${audioData.type}`);
      }

      console.log(`[AudioConsumer] ✓ Chunk ${this.currentIndex + 1} finished`);

      // Callback: chunk end
      if (this.onChunkEnd) {
        this.onChunkEnd({
          index: this.currentIndex,
          text: queueItem.text
        });
      }

    } catch (error) {
      console.error(`[AudioConsumer] Error playing chunk ${this.currentIndex + 1}:`, error);

      // Callback: error
      if (this.onError) {
        this.onError({
          index: this.currentIndex,
          error: error,
          chunk: queueItem
        });
      }

      // Continue with next chunk (don't fail entire playback)
    }
  }

  /**
   * Play audio using Web Speech API
   * @param {SpeechSynthesisUtterance} utterance
   * @returns {Promise<void>}
   */
  playWebSpeech(utterance) {
    return new Promise((resolve, reject) => {
      const synth = window.speechSynthesis;

      // Check if stopped
      if (this.isStopped) {
        resolve();
        return;
      }

      utterance.onend = () => {
        resolve();
      };

      utterance.onerror = (e) => {
        console.error('[AudioConsumer] Web Speech error:', e);
        reject(e);
      };

      console.log('[AudioConsumer] Speaking with Web Speech API...');
      synth.speak(utterance);
    });
  }

  /**
   * Play audio using Web Audio API
   * @param {AudioBuffer} audioBuffer
   * @returns {Promise<void>}
   */
  playAudioBuffer(audioBuffer) {
    return new Promise((resolve, reject) => {
      // Check if stopped
      if (this.isStopped) {
        resolve();
        return;
      }

      // Create audio context if needed
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      // Create source
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      this.currentAudioSource = source;

      source.onended = () => {
        this.currentAudioSource = null;
        resolve();
      };

      console.log('[AudioConsumer] Playing with Web Audio API...');
      source.start(0);
    });
  }

  /**
   * Main playback loop - consumes queue sequentially
   * Continues until queue is empty AND producer is done
   */
  async playbackLoop() {
    console.log('\n[AudioConsumer] ========== STARTING PLAYBACK LOOP ==========');

    while (true) {
      // Check if stopped
      if (this.isStopped) {
        console.log('[AudioConsumer] Playback stopped by user');
        break;
      }

      const queue = this.producer.getQueue();
      const producerState = this.producer.getState();

      // Check if we have a chunk to play
      if (this.currentIndex < queue.length) {
        const chunk = queue[this.currentIndex];

        // Play this chunk
        await this.playChunk(chunk);

        this.currentIndex++;

        // Progress callback
        if (this.onProgress) {
          this.onProgress({
            currentIndex: this.currentIndex,
            totalGenerated: queue.length,
            isGenerating: producerState.isGenerating
          });
        }

      } else {
        // No chunk available yet

        // Check if producer is done
        if (!producerState.isGenerating) {
          // Producer is done AND we've played all chunks
          console.log('[AudioConsumer] All chunks played, producer finished');
          break;
        }

        // Wait for next chunk to be generated
        console.log('[AudioConsumer] Waiting for next chunk...');
        await this.sleep(100); // Poll every 100ms
      }
    }

    console.log('[AudioConsumer] ========== PLAYBACK COMPLETE ==========');
    this.isPlaying = false;

    // Callback: playback end
    if (this.onPlayEnd) {
      this.onPlayEnd({
        totalPlayed: this.currentIndex
      });
    }
  }

  /**
   * Start playback
   * @returns {Promise<void>}
   */
  async play() {
    if (this.isPlaying) {
      console.warn('[AudioConsumer] Already playing');
      return;
    }

    console.log('[AudioConsumer] Starting playback...');

    this.isPlaying = true;
    this.isStopped = false;
    this.currentIndex = 0;

    // Callback: playback start
    if (this.onPlayStart) {
      this.onPlayStart();
    }

    // Start playback loop
    await this.playbackLoop();
  }

  /**
   * Stop playback immediately
   */
  stop() {
    console.log('[AudioConsumer] Stopping playback...');

    this.isStopped = true;
    this.isPlaying = false;

    // Stop Web Speech
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }

    // Stop Web Audio
    if (this.currentAudioSource) {
      try {
        this.currentAudioSource.stop();
      } catch (e) {
        // Already stopped
      }
      this.currentAudioSource = null;
    }

    // Clear producer queue
    this.producer.stop();

    console.log('[AudioConsumer] Playback stopped');
  }

  /**
   * Get current playback state
   * @returns {Object}
   */
  getState() {
    const queue = this.producer.getQueue();
    const producerState = this.producer.getState();

    return {
      isPlaying: this.isPlaying,
      currentIndex: this.currentIndex,
      totalGenerated: queue.length,
      isGenerating: producerState.isGenerating,
      isStopped: this.isStopped
    };
  }

  /**
   * Utility: sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Orchestrator - Combines Producer and Consumer for complete cinematic playback
 * This is the main entry point for cinematic voice
 */
class CinematicVoiceOrchestrator {
  constructor(provider = 'web_speech') {
    this.provider = provider;
    this.producer = null;
    this.consumer = null;
    this.isActive = false;

    // UI callbacks
    this.onStatusUpdate = null;
  }

  /**
   * Play story with cinematic multi-voice narration
   * @param {string} rawText - Raw story text
   * @param {string[]} [characterList] - Optional character list
   */
  async playCinematic(rawText, characterList = null) {
    console.log('\n[CinematicOrchestrator] ========== STARTING CINEMATIC PLAYBACK ==========');
    console.log(`[CinematicOrchestrator] Provider: ${this.provider}`);

    this.isActive = true;

    try {
      // PHASE 1+2+3: Parse, detect speakers, assign voices
      this.updateStatus('Analyzing story...');
      const result = parseScriptComplete(rawText, characterList, this.provider);

      console.log('[CinematicOrchestrator] Script prepared:', result.script.length, 'blocks');
      console.log('[CinematicOrchestrator] Characters:', Object.keys(result.registry));

      // PHASE 4: Create producer and start generation
      this.updateStatus('Generating audio...');
      this.producer = new AudioProducer(this.provider);

      this.producer.onProgress = (progress) => {
        this.updateStatus(`Generating block ${progress.current}/${progress.total}...`);
      };

      // Start generation in background
      const generationPromise = this.producer.generateScript(result.script);

      // PHASE 5: Create consumer and start playback immediately
      this.consumer = new AudioConsumer(this.producer);

      this.consumer.onPlayStart = () => {
        this.updateStatus('Playing cinematic scene...');
      };

      this.consumer.onChunkStart = (chunk) => {
        console.log(`[CinematicOrchestrator] Now playing: ${chunk.speaker} - "${chunk.text.substring(0, 30)}..."`);
        this.updateStatus(`${chunk.speaker}: "${chunk.text.substring(0, 40)}..."`);
      };

      this.consumer.onPlayEnd = () => {
        this.updateStatus('Playback finished');
        this.isActive = false;
      };

      this.consumer.onError = (error) => {
        console.error('[CinematicOrchestrator] Playback error:', error);
      };

      // Start playback (will wait for first chunk)
      console.log('[CinematicOrchestrator] Starting playback...');
      await this.consumer.play();

      // Wait for generation to complete
      await generationPromise;

      console.log('[CinematicOrchestrator] ========== CINEMATIC PLAYBACK COMPLETE ==========');

    } catch (error) {
      console.error('[CinematicOrchestrator] Error:', error);
      this.updateStatus('Error during playback');
      this.isActive = false;
      throw error;
    }
  }

  /**
   * Stop cinematic playback
   */
  stop() {
    console.log('[CinematicOrchestrator] Stopping...');

    if (this.consumer) {
      this.consumer.stop();
    }

    this.isActive = false;
    this.updateStatus('Stopped');
  }

  /**
   * Get orchestrator state
   */
  getState() {
    if (!this.producer || !this.consumer) {
      return {
        isActive: this.isActive,
        status: 'Not started'
      };
    }

    return {
      isActive: this.isActive,
      producer: this.producer.getState(),
      consumer: this.consumer.getState()
    };
  }

  /**
   * Update UI status (if callback provided)
   */
  updateStatus(message) {
    console.log(`[CinematicOrchestrator] ${message}`);
    if (this.onStatusUpdate) {
      this.onStatusUpdate(message);
    }
  }
}

/**
 * Test Phase 5: Complete cinematic playback
 */
async function testCinematicPlayback() {
  console.log('\n========================================');
  console.log('TESTING CINEMATIC PLAYBACK (PHASE 1-5)');
  console.log('========================================\n');

  // Test: Full cinematic experience
  const testText = `
    Jack stood abruptly, wine sloshing from his glass.
    "What the hell, dude? You think this is funny?" 
    His voice rose with each word.
    Emily flinched at Jack's outburst.
    "Maybe it was an animal?" she suggested quietly.
    Jack shook his head.
    "No way. Someone was watching us."
  `.trim();

  console.log('Story Text:', testText);

  const orchestrator = new CinematicVoiceOrchestrator('web_speech');

  orchestrator.onStatusUpdate = (status) => {
    console.log(`[STATUS] ${status}`);
  };

  try {
    await orchestrator.playCinematic(testText);
    console.log('Final State:', orchestrator.getState());
  } catch (e) {
    console.error('Test failed:', e);
  }

  console.log('\n========================================');
  console.log('CINEMATIC PLAYBACK TEST COMPLETE');
  console.log('========================================\n');
}

// Uncomment to run full cinematic test:
// testCinematicPlayback();

// ============================================================================
// SCRIPT PARSING - PHASE 6: EXPERIENCE ORCHESTRATION LAYER
// ============================================================================

/**
 * Global State Manager - Single source of truth for cinematic voice system
 */
class CinematicStateManager {
  constructor() {
    this.state = {
      // Feature flags
      isCinematicModeEnabled: false,
      isPremiumUser: false,

      // Runtime state
      isGenerating: false,
      isPlaying: false,
      isActive: false,

      // Configuration
      currentProvider: 'web_speech',

      // Session tracking
      currentSessionId: null,
      currentStoryText: null,

      // Progress tracking
      statusMessage: 'Ready',
      currentPhase: null, // 'parsing', 'generating', 'playing'
      progress: {
        current: 0,
        total: 0
      },

      // Error state
      hasError: false,
      errorMessage: null,
      errorDetails: null
    };

    // State change listeners
    this.listeners = [];
  }

  /**
   * Get current state (read-only)
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Update state and notify listeners
   */
  setState(updates) {
    const oldState = { ...this.state };

    this.state = {
      ...this.state,
      ...updates
    };

    // Notify listeners
    this.listeners.forEach(listener => {
      listener(this.state, oldState);
    });
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener) {
    this.listeners.push(listener);

    // Return unsubscribe function
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Reset to initial state
   */
  reset() {
    this.setState({
      isGenerating: false,
      isPlaying: false,
      isActive: false,
      currentSessionId: null,
      currentStoryText: null,
      statusMessage: 'Ready',
      currentPhase: null,
      progress: { current: 0, total: 0 },
      hasError: false,
      errorMessage: null,
      errorDetails: null
    });
  }
}

/**
 * Experience Orchestrator - High-level coordinator for cinematic voice system
 * This is the "conductor" that manages the entire user experience
 */
class CinematicExperienceOrchestrator {
  constructor() {
    // State manager
    this.stateManager = new CinematicStateManager();

    // Active components
    this.orchestrator = null; // CinematicVoiceOrchestrator instance

    // Initialize
    this.initialize();
  }

  /**
   * Initialize orchestrator
   */
  initialize() {
    console.log('[ExperienceOrchestrator] Initializing...');

    // Load settings
    this.loadSettings();

    // Check premium status
    this.checkPremiumStatus();

    console.log('[ExperienceOrchestrator] Initialized');
    console.log('[ExperienceOrchestrator] Cinematic Mode:', this.stateManager.state.isCinematicModeEnabled);
    console.log('[ExperienceOrchestrator] Premium User:', this.stateManager.state.isPremiumUser);
  }

  /**
   * Load settings from storage
   */
  loadSettings() {
    const provider = StorageManager.get('provider', CONFIG.DEFAULTS.provider);
    const cinematicEnabled = StorageManager.get('cinematicMode', false);

    this.stateManager.setState({
      currentProvider: provider,
      isCinematicModeEnabled: cinematicEnabled
    });
  }

  /**
   * Check if user has premium access
   * For now, returns true (no paywall implemented yet)
   * Future: Check actual subscription status
   */
  checkPremiumStatus() {
    // TODO: Implement actual premium check
    // For now, treat all users as premium to enable testing
    const isPremium = true;

    this.stateManager.setState({
      isPremiumUser: isPremium
    });

    return isPremium;
  }

  /**
   * Toggle cinematic mode ON/OFF
   */
  toggleCinematicMode() {
    const currentState = this.stateManager.state.isCinematicModeEnabled;
    const newState = !currentState;

    console.log('[ExperienceOrchestrator] Toggling cinematic mode:', newState);

    // Check premium access for cinematic mode
    if (newState && !this.stateManager.state.isPremiumUser) {
      this.handlePremiumRequired();
      return false;
    }

    // Update state
    this.stateManager.setState({
      isCinematicModeEnabled: newState
    });

    // Save to storage
    StorageManager.set('cinematicMode', newState);

    return newState;
  }

  /**
   * Handle premium feature access attempt by free user
   */
  handlePremiumRequired() {
    console.log('[ExperienceOrchestrator] Premium access required');

    this.stateManager.setState({
      hasError: true,
      errorMessage: 'Premium feature',
      errorDetails: 'Cinematic voice mode requires a premium account. Please upgrade to unlock multi-voice narration.'
    });

    // Show user message
    alert('🎭 Cinematic Voice Mode is a Premium Feature\n\nUpgrade to unlock:\n• Multi-voice narration\n• Character-specific voices\n• Automatic speaker detection\n• Premium TTS providers');
  }

  /**
   * Set TTS provider
   */
  setProvider(provider) {
    console.log('[ExperienceOrchestrator] Setting provider:', provider);

    this.stateManager.setState({
      currentProvider: provider
    });

    StorageManager.set('provider', provider);
  }

  /**
   * Main entry point: Play story
   * Decides whether to use cinematic or simple TTS
   */
  async play(storyText, options = {}) {
    console.log('\n[ExperienceOrchestrator] ========== PLAY REQUEST ==========');
    console.log('[ExperienceOrchestrator] Text length:', storyText.length);
    console.log('[ExperienceOrchestrator] Cinematic mode:', this.stateManager.state.isCinematicModeEnabled);

    // Check if already active
    if (this.stateManager.state.isActive) {
      console.log('[ExperienceOrchestrator] Already active, stopping first...');
      this.stop();
    }

    // Generate session ID
    const sessionId = `session_${Date.now()}`;

    this.stateManager.setState({
      isActive: true,
      currentSessionId: sessionId,
      currentStoryText: storyText,
      hasError: false,
      errorMessage: null
    });

    try {
      // DECISION POINT: Cinematic or Simple TTS?
      if (this.stateManager.state.isCinematicModeEnabled) {
        await this.playCinematic(storyText, sessionId);
      } else {
        await this.playSimple(storyText, sessionId);
      }

    } catch (error) {
      this.handleError(error, 'playback');
    } finally {
      this.stateManager.setState({
        isActive: false,
        isGenerating: false,
        isPlaying: false,
        currentPhase: null
      });
    }
  }

  /**
   * Play with cinematic multi-voice mode (Phases 1-5)
   */
  async playCinematic(storyText, sessionId) {
    console.log('[ExperienceOrchestrator] Starting CINEMATIC playback...');

    this.stateManager.setState({
      statusMessage: 'Preparing cinematic scene...',
      currentPhase: 'parsing'
    });

    try {
      // Create orchestrator
      this.orchestrator = new CinematicVoiceOrchestrator(
        this.stateManager.state.currentProvider
      );

      // Wire up callbacks
      this.orchestrator.onStatusUpdate = (status) => {
        this.updateStatus(status);
      };

      // Start cinematic playback
      this.stateManager.setState({
        statusMessage: 'Analyzing story...',
        currentPhase: 'parsing'
      });

      await this.orchestrator.playCinematic(storyText);

      // Success
      this.stateManager.setState({
        statusMessage: 'Cinematic scene finished',
        currentPhase: null
      });

    } catch (error) {
      console.error('[ExperienceOrchestrator] Cinematic playback error:', error);
      throw error;
    }
  }

  /**
   * Play with simple single-voice TTS (backward compatible)
   */
  async playSimple(storyText, sessionId) {
    console.log('[ExperienceOrchestrator] Starting SIMPLE playback...');

    this.stateManager.setState({
      statusMessage: 'Generating voice...',
      currentPhase: 'generating',
      isGenerating: true
    });

    try {
      // Use existing VoiceController logic
      // This would integrate with the existing TTS system
      // For now, just simulate

      this.stateManager.setState({
        statusMessage: 'Playing...',
        currentPhase: 'playing',
        isGenerating: false,
        isPlaying: true
      });

      // TODO: Integrate with existing VoiceController.play()
      // For now, just log
      console.log('[ExperienceOrchestrator] [SIMPLE MODE] Would play with existing TTS');

      // Simulate playback
      await new Promise(resolve => setTimeout(resolve, 1000));

      this.stateManager.setState({
        statusMessage: 'Playback finished',
        currentPhase: null,
        isPlaying: false
      });

    } catch (error) {
      console.error('[ExperienceOrchestrator] Simple playback error:', error);
      throw error;
    }
  }

  /**
   * Stop current playback
   */
  stop() {
    console.log('[ExperienceOrchestrator] Stopping...');

    if (this.orchestrator) {
      this.orchestrator.stop();
      this.orchestrator = null;
    }

    this.stateManager.reset();

    console.log('[ExperienceOrchestrator] Stopped');
  }

  /**
   * Cancel current session
   */
  cancel() {
    console.log('[ExperienceOrchestrator] Cancelling session...');
    this.stop();
  }

  /**
   * Update status message
   */
  updateStatus(message) {
    console.log(`[ExperienceOrchestrator] Status: ${message}`);

    // Parse status to update phase
    let phase = this.stateManager.state.currentPhase;
    let isGenerating = false;
    let isPlaying = false;

    if (message.includes('Analyzing') || message.includes('Detecting')) {
      phase = 'parsing';
    } else if (message.includes('Generating')) {
      phase = 'generating';
      isGenerating = true;
    } else if (message.includes('Playing')) {
      phase = 'playing';
      isPlaying = true;
    }

    this.stateManager.setState({
      statusMessage: message,
      currentPhase: phase,
      isGenerating: isGenerating,
      isPlaying: isPlaying
    });
  }

  /**
   * Handle errors gracefully
   */
  handleError(error, context = 'unknown') {
    console.error(`[ExperienceOrchestrator] Error in ${context}:`, error);

    // Determine user-friendly message
    let userMessage = 'An error occurred during playback';

    if (error.message?.includes('API key')) {
      userMessage = 'API key not configured. Please add your API key in settings.';
    } else if (error.message?.includes('network') || error.message?.includes('fetch')) {
      userMessage = 'Network error. Please check your connection.';
    } else if (error.message?.includes('quota') || error.message?.includes('credits')) {
      userMessage = 'API quota exceeded. Please check your account.';
    }

    this.stateManager.setState({
      hasError: true,
      errorMessage: userMessage,
      errorDetails: error.message,
      statusMessage: 'Error',
      isActive: false,
      isGenerating: false,
      isPlaying: false
    });

    // Show alert
    alert(`❌ ${userMessage}\n\nDetails: ${error.message}`);
  }

  /**
   * Get current state
   */
  getState() {
    return this.stateManager.getState();
  }

  /**
   * Subscribe to state changes
   */
  subscribe(listener) {
    return this.stateManager.subscribe(listener);
  }

  /**
   * Check if cinematic mode is available
   */
  isCinematicAvailable() {
    return this.stateManager.state.isPremiumUser;
  }

  /**
   * Get session info
   */
  getSessionInfo() {
    const state = this.stateManager.state;
    return {
      sessionId: state.currentSessionId,
      isActive: state.isActive,
      phase: state.currentPhase,
      status: state.statusMessage
    };
  }
}

// ============================================================================
// GLOBAL INSTANCE & INTEGRATION
// ============================================================================

/**
 * Global cinematic experience orchestrator instance
 * This is the single entry point for all cinematic voice functionality
 */
let globalCinematicOrchestrator = null;

/**
 * Get or create global orchestrator instance
 */
function getCinematicOrchestrator() {
  if (!globalCinematicOrchestrator) {
    globalCinematicOrchestrator = new CinematicExperienceOrchestrator();
  }
  return globalCinematicOrchestrator;
}

/**
 * High-level API for UI integration
 */
const CinematicVoiceAPI = {
  /**
   * Initialize the system
   */
  init() {
    console.log('[CinematicVoiceAPI] Initializing...');
    getCinematicOrchestrator();
  },

  /**
   * Play story text
   */
  async play(text) {
    const orchestrator = getCinematicOrchestrator();
    await orchestrator.play(text);
  },

  /**
   * Stop playback
   */
  stop() {
    const orchestrator = getCinematicOrchestrator();
    orchestrator.stop();
  },

  /**
   * Toggle cinematic mode
   */
  toggleCinematicMode() {
    const orchestrator = getCinematicOrchestrator();
    return orchestrator.toggleCinematicMode();
  },

  /**
   * Set provider
   */
  setProvider(provider) {
    const orchestrator = getCinematicOrchestrator();
    orchestrator.setProvider(provider);
  },

  /**
   * Get current state
   */
  getState() {
    const orchestrator = getCinematicOrchestrator();
    return orchestrator.getState();
  },

  /**
   * Subscribe to state changes
   */
  subscribe(listener) {
    const orchestrator = getCinematicOrchestrator();
    return orchestrator.subscribe(listener);
  },

  /**
   * Check if cinematic mode is available
   */
  isCinematicAvailable() {
    const orchestrator = getCinematicOrchestrator();
    return orchestrator.isCinematicAvailable();
  }
};

// ============================================================================
// DEBUGGING & ERROR TRACKING SYSTEM
// ============================================================================

/**
 * Debug logger for cinematic voice system
 * Provides detailed logging for each phase
 */
class CinematicDebugger {
  constructor() {
    this.enabled = true; // Set to false to disable debugging
    this.phaseErrors = [];
    this.phaseLogs = [];
  }

  /**
   * Log a phase start
   */
  phaseStart(phaseNumber, phaseName) {
    const message = `🔵 PHASE ${phaseNumber} START: ${phaseName}`;
    console.log(`\n${'='.repeat(60)}`);
    console.log(message);
    console.log('='.repeat(60));

    this.phaseLogs.push({
      phase: phaseNumber,
      name: phaseName,
      type: 'start',
      timestamp: Date.now(),
      message: message
    });
  }

  /**
   * Log a phase success
   */
  phaseSuccess(phaseNumber, phaseName, data = null) {
    const message = `✅ PHASE ${phaseNumber} SUCCESS: ${phaseName}`;
    console.log(message);
    if (data) {
      console.log('Data:', data);
    }
    console.log('='.repeat(60) + '\n');

    this.phaseLogs.push({
      phase: phaseNumber,
      name: phaseName,
      type: 'success',
      timestamp: Date.now(),
      message: message,
      data: data
    });
  }

  /**
   * Log a phase error
   */
  phaseError(phaseNumber, phaseName, error) {
    const message = `❌ PHASE ${phaseNumber} ERROR: ${phaseName}`;
    console.error(message);
    console.error('Error:', error);
    console.error('Error message:', error?.message);
    console.error('Error stack:', error?.stack);
    console.log('='.repeat(60) + '\n');

    this.phaseErrors.push({
      phase: phaseNumber,
      name: phaseName,
      error: error,
      message: error?.message,
      stack: error?.stack,
      timestamp: Date.now()
    });

    this.phaseLogs.push({
      phase: phaseNumber,
      name: phaseName,
      type: 'error',
      timestamp: Date.now(),
      message: message,
      error: error
    });
  }

  /**
   * Log detailed step within a phase
   */
  step(phaseNumber, stepName, data = null) {
    if (!this.enabled) return;

    const message = `  ↳ Step: ${stepName}`;
    console.log(message);
    if (data) {
      console.log('    Data:', data);
    }
  }

  /**
   * Get summary of all errors
   */
  getErrorSummary() {
    return {
      totalErrors: this.phaseErrors.length,
      errors: this.phaseErrors,
      lastError: this.phaseErrors[this.phaseErrors.length - 1]
    };
  }

  /**
   * Get full log
   */
  getFullLog() {
    return this.phaseLogs;
  }

  /**
   * Print error summary
   */
  printErrorSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('🔍 CINEMATIC VOICE DEBUG SUMMARY');
    console.log('='.repeat(60));

    if (this.phaseErrors.length === 0) {
      console.log('✅ No errors detected');
    } else {
      console.log(`❌ ${this.phaseErrors.length} error(s) detected:`);
      this.phaseErrors.forEach((err, index) => {
        console.log(`\n${index + 1}. Phase ${err.phase}: ${err.name}`);
        console.log(`   Message: ${err.message}`);
        console.log(`   Stack: ${err.stack?.substring(0, 200)}...`);
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('Full log entries:', this.phaseLogs.length);
    console.log('='.repeat(60) + '\n');
  }

  /**
   * Reset debug state
   */
  reset() {
    this.phaseErrors = [];
    this.phaseLogs = [];
  }
}

// Global debugger instance
const cinematicDebugger = new CinematicDebugger();

/**
 * Wrapper function to test cinematic voice with full debugging
 */
async function debugCinematicVoice(text) {
  console.log('\n\n');
  console.log('█'.repeat(60));
  console.log('█  CINEMATIC VOICE DEBUG SESSION');
  console.log('█'.repeat(60));
  console.log('\nStory text:', text);
  console.log('\n');

  cinematicDebugger.reset();

  try {
    // PHASE 1: Parse Script
    cinematicDebugger.phaseStart(1, 'Script Parsing');
    let structuredScript;
    try {
      cinematicDebugger.step(1, 'Calling parseScript()');
      structuredScript = parseScript(text);

      cinematicDebugger.step(1, 'Validating output', {
        blocksCount: structuredScript?.length,
        hasBlocks: structuredScript && structuredScript.length > 0
      });

      if (!structuredScript || structuredScript.length === 0) {
        throw new Error('parseScript returned empty or null result');
      }

      cinematicDebugger.phaseSuccess(1, 'Script Parsing', {
        blocks: structuredScript.length,
        sample: structuredScript[0]
      });
    } catch (error) {
      cinematicDebugger.phaseError(1, 'Script Parsing', error);
      throw error;
    }

    // PHASE 2: Speaker Detection
    cinematicDebugger.phaseStart(2, 'Speaker Detection');
    let characterList, scriptWithSpeakers;
    try {
      cinematicDebugger.step(2, 'Calling extractCharacterNames()');
      characterList = extractCharacterNames(text);

      cinematicDebugger.step(2, 'Characters extracted', {
        count: characterList?.length,
        names: characterList
      });

      if (!characterList) {
        throw new Error('extractCharacterNames returned null');
      }

      cinematicDebugger.step(2, 'Calling detectSpeakers()');
      scriptWithSpeakers = detectSpeakers(structuredScript, characterList);

      cinematicDebugger.step(2, 'Speakers detected', {
        blocksWithSpeakers: scriptWithSpeakers?.filter(b => b.speaker).length
      });

      if (!scriptWithSpeakers) {
        throw new Error('detectSpeakers returned null');
      }

      cinematicDebugger.phaseSuccess(2, 'Speaker Detection', {
        characters: characterList?.length,
        dialogueBlocks: scriptWithSpeakers?.filter(b => b.type === 'dialogue').length
      });
    } catch (error) {
      cinematicDebugger.phaseError(2, 'Speaker Detection', error);
      throw error;
    }

    // PHASE 3: Gender Detection & Voice Casting
    cinematicDebugger.phaseStart(3, 'Gender Detection & Voice Casting');
    let result;
    try {
      cinematicDebugger.step(3, 'Calling prepareVoiceCasting()');
      result = prepareVoiceCasting(scriptWithSpeakers, characterList, 'web_speech');

      cinematicDebugger.step(3, 'Voice casting prepared', {
        scriptBlocks: result?.script?.length,
        characters: Object.keys(result?.registry || {}).length,
        registry: result?.registry
      });

      if (!result || !result.script || !result.registry) {
        throw new Error('prepareVoiceCasting returned invalid result');
      }

      cinematicDebugger.phaseSuccess(3, 'Gender Detection & Voice Casting', {
        characters: Object.keys(result.registry).length,
        voices: Object.values(result.registry).map(c => c.voice)
      });
    } catch (error) {
      cinematicDebugger.phaseError(3, 'Gender Detection & Voice Casting', error);
      throw error;
    }

    // PHASE 4: Audio Production
    cinematicDebugger.phaseStart(4, 'Audio Production');
    let producer, generationPromise;
    try {
      cinematicDebugger.step(4, 'Creating AudioProducer');
      producer = new AudioProducer('web_speech');

      if (!producer) {
        throw new Error('Failed to create AudioProducer');
      }

      cinematicDebugger.step(4, 'Setting up producer callbacks');
      producer.onProgress = (progress) => {
        cinematicDebugger.step(4, `Progress: ${progress.current}/${progress.total}`, progress);
      };

      producer.onError = (error) => {
        console.error('Producer error:', error);
      };

      cinematicDebugger.step(4, 'Starting audio generation', {
        blocks: result.script.length
      });

      generationPromise = producer.generateScript(result.script);

      cinematicDebugger.step(4, 'Generation started, waiting for first chunk...');

      // Wait a bit for first chunk
      await new Promise(resolve => setTimeout(resolve, 500));

      const state = producer.getState();
      cinematicDebugger.step(4, 'Producer state after 500ms', state);

      if (state.queueSize === 0 && !state.isGenerating) {
        throw new Error('Producer not generating audio');
      }

      cinematicDebugger.phaseSuccess(4, 'Audio Production (Started)', {
        isGenerating: state.isGenerating,
        queueSize: state.queueSize
      });
    } catch (error) {
      cinematicDebugger.phaseError(4, 'Audio Production', error);
      throw error;
    }

    // PHASE 5: Audio Consumption
    cinematicDebugger.phaseStart(5, 'Audio Consumption');
    let consumer;
    try {
      cinematicDebugger.step(5, 'Creating AudioConsumer');
      consumer = new AudioConsumer(producer);

      if (!consumer) {
        throw new Error('Failed to create AudioConsumer');
      }

      cinematicDebugger.step(5, 'Setting up consumer callbacks');
      consumer.onPlayStart = () => {
        cinematicDebugger.step(5, 'Playback started');
      };

      consumer.onChunkStart = (chunk) => {
        cinematicDebugger.step(5, `Playing chunk ${chunk.index + 1}`, {
          speaker: chunk.speaker,
          text: chunk.text?.substring(0, 30) + '...'
        });
      };

      consumer.onPlayEnd = () => {
        cinematicDebugger.step(5, 'Playback finished');
      };

      consumer.onError = (error) => {
        console.error('Consumer error:', error);
      };

      cinematicDebugger.step(5, 'Starting playback');
      const playbackPromise = consumer.play();

      cinematicDebugger.step(5, 'Waiting for playback and generation to complete');

      await Promise.all([playbackPromise, generationPromise]);

      cinematicDebugger.phaseSuccess(5, 'Audio Consumption', {
        totalPlayed: consumer.currentIndex
      });
    } catch (error) {
      cinematicDebugger.phaseError(5, 'Audio Consumption', error);
      throw error;
    }

    // PHASE 6: Experience Orchestration (we tested phases 1-5 directly)
    cinematicDebugger.phaseStart(6, 'Experience Orchestration');
    try {
      cinematicDebugger.step(6, 'All phases completed successfully');
      cinematicDebugger.step(6, 'Experience orchestration would coordinate these phases');
      cinematicDebugger.phaseSuccess(6, 'Experience Orchestration');
    } catch (error) {
      cinematicDebugger.phaseError(6, 'Experience Orchestration', error);
      throw error;
    }

    console.log('\n✅ ALL PHASES COMPLETED SUCCESSFULLY!\n');

  } catch (error) {
    console.error('\n❌ CINEMATIC VOICE FAILED\n');
    console.error('Final error:', error);
  } finally {
    cinematicDebugger.printErrorSummary();
  }
}

/**
 * Quick test function - Call from console or button click
 */
async function quickDebugTest() {
  const testText = 'Jack stood up. "Hello everyone!" Emily smiled. "Hi Jack!"';
  await debugCinematicVoice(testText);
}

/**
 * Add a test button to the page (call this from console)
 */
function addCinematicTestButton() {
  // Remove existing button if any
  const existing = document.getElementById('cinematicTestBtn');
  if (existing) existing.remove();

  // Create button
  const button = document.createElement('button');
  button.id = 'cinematicTestBtn';
  button.textContent = '🎬 Test Cinematic Voice';
  button.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 10000;
    padding: 15px 25px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
    box-shadow: 0 4px 15px rgba(0,0,0,0.2);
    transition: transform 0.2s;
  `;

  button.onmouseover = () => button.style.transform = 'scale(1.05)';
  button.onmouseout = () => button.style.transform = 'scale(1)';

  button.onclick = async () => {
    button.disabled = true;
    button.textContent = '⏳ Testing...';

    try {
      await quickDebugTest();
      button.textContent = '✅ Test Complete!';
      setTimeout(() => {
        button.textContent = '🎬 Test Cinematic Voice';
        button.disabled = false;
      }, 2000);
    } catch (error) {
      button.textContent = '❌ Test Failed';
      console.error('Test error:', error);
      setTimeout(() => {
        button.textContent = '🎬 Test Cinematic Voice';
        button.disabled = false;
      }, 2000);
    }
  };

  document.body.appendChild(button);
  console.log('✅ Test button added! Click it to run cinematic voice test with audio.');
}

// Auto-run on page load (safe - just adds button, doesn't play audio)
// setTimeout(() => {
//   if (window.location.href.includes('janitorai.com')) {
//     addCinematicTestButton();
//     console.log('🎬 Cinematic Voice Test Button Ready!');
//     console.log('Click the bottom-right button to test with audio playback.');
//   }
// }, 2000);

// Uncomment to run debugging WITHOUT audio (just logs):
// quickDebugTest();

/**
 * Test Phase 6: Experience orchestration
 */
async function testExperienceOrchestration() {
  console.log('\n========================================');
  console.log('TESTING EXPERIENCE ORCHESTRATION (PHASE 6)');
  console.log('========================================\n');

  // Initialize
  CinematicVoiceAPI.init();

  // Subscribe to state changes
  const unsubscribe = CinematicVoiceAPI.subscribe((newState, oldState) => {
    console.log('[STATE CHANGE]', {
      phase: newState.currentPhase,
      status: newState.statusMessage,
      isActive: newState.isActive
    });
  });

  // Test 1: Check initial state
  console.log('--- TEST 1: Initial State ---');
  console.log('State:', CinematicVoiceAPI.getState());

  // Test 2: Toggle cinematic mode
  console.log('\n--- TEST 2: Toggle Cinematic Mode ---');
  const enabled = CinematicVoiceAPI.toggleCinematicMode();
  console.log('Cinematic mode enabled:', enabled);

  // Test 3: Play with cinematic mode
  console.log('\n--- TEST 3: Play with Cinematic Mode ---');
  const testText = 'Jack stood up. "Hello everyone!" Emily smiled. "Hi Jack!"';

  try {
    await CinematicVoiceAPI.play(testText);
    console.log('Playback completed successfully');
  } catch (e) {
    console.error('Playback failed:', e);
  }

  // Test 4: Check final state
  console.log('\n--- TEST 4: Final State ---');
  console.log('State:', CinematicVoiceAPI.getState());

  // Cleanup
  unsubscribe();

  console.log('\n========================================');
  console.log('EXPERIENCE ORCHESTRATION TEST COMPLETE');
  console.log('========================================\n');
}

// Uncomment to run Phase 6 tests:
// testExperienceOrchestration();

// ============================================================================

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

        <div class="jv-control">
          <label class="jv-toggle-label">
            <input type="checkbox" id="jv-cinematic-toggle" />
            <span class="jv-toggle-slider"></span>
            <span class="jv-toggle-text">🎬 Cinematic Mode <span class="jv-badge premium">Multi-Voice</span></span>
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

    // Cinematic Mode Toggle
    this.panel.querySelector('#jv-cinematic-toggle').addEventListener('change', (e) => {
      this.controller.setCinematicMode(e.target.checked);
      console.log('[Janitor Voice] Cinematic Mode:', e.target.checked ? 'ON' : 'OFF');
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
    this.panel.querySelector('#jv-cinematic-toggle').checked = s.cinematicMode || false;
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
    // Stop cinematic consumer if exists
    if (this.cinematicConsumer) {
      this.cinematicConsumer.stop();
      this.cinematicConsumer = null;
    }

    Object.values(this.engines).forEach(e => e.cancel());
    this.highlighter.stop();
    if (this.currentButton) {
      this.injector.setButtonState(this.currentButton, 'idle');
      this.currentButton = null;
    }
    this.playbackState = 'IDLE';
    this.uiPanel.updateStatus();
  }

  async play(element, text, button) {
    this.stop(); // Ensure everything is stopped first

    this.currentButton = button;
    this.setPlaybackState(button, 'PLAYING'); // Optimistic state

    // Check if cinematic mode is enabled
    const cinematicEnabled = this.settings.cinematicMode || false;

    if (cinematicEnabled) {
      console.log('[Janitor Voice] 🎬 Using Cinematic Multi-Voice Mode');
      this.injector.setButtonState(button, 'loading');

      try {
        // Use cinematic voice system
        await this.playCinematic(text, element, button);
      } catch (error) {
        console.error('[Janitor Voice] Cinematic playback failed:', error);
        // Fallback to normal TTS
        this.playNormal(element, text, button);
      }
    } else {
      console.log('[Janitor Voice] Using Normal Single-Voice Mode');
      this.playNormal(element, text, button);
    }
  }

  /**
   * Play with cinematic multi-voice system
   */
  async playCinematic(text, element, button) {
    console.log('[Janitor Voice] 🎬 Starting cinematic playback...');

    // Phase 1-3: Parse and prepare script
    // Pass the currently selected narrator voice
    const voiceURI = this.settings.voiceURI || null;
    const result = parseScriptComplete(text, null, this.settings.provider || 'web_speech', voiceURI);

    console.log('[Janitor Voice] Parsed script:', result.script.length, 'blocks');
    console.log('[Janitor Voice] Characters:', Object.keys(result.registry).join(', '));

    // Phase 4: Create audio producer
    const producer = new AudioProducer(this.settings.provider || 'web_speech');

    producer.onProgress = (progress) => {
      const msg = `Generating ${progress.current}/${progress.total}...`;
      this.uiPanel.updateStatus(msg);
    };

    producer.onComplete = (completedResult) => {
      console.log('[Janitor Voice] Audio generation complete:', completedResult.totalChunks, 'chunks');
    };

    producer.onError = (error) => {
      console.error('[Janitor Voice] Producer error:', error);
    };

    // Start generation
    const generationPromise = producer.generateScript(result.script);

    // Phase 5: Create audio consumer and start playback
    const consumer = new AudioConsumer(producer);

    consumer.onPlayStart = () => {
      console.log('[Janitor Voice] 🎬 Cinematic playback started');
      this.injector.setButtonState(button, 'playing');
    };

    consumer.onChunkStart = (chunk) => {
      console.log('[Janitor Voice] 🎙️', chunk.speaker + ':', chunk.text.substring(0, 50) + '...');
      // Could add highlighting here if needed
    };

    consumer.onPlayEnd = () => {
      console.log('[Janitor Voice] 🎬 Cinematic playback ended');
      if (this.currentButton === button) {
        this.stop();
      }
    };

    consumer.onError = (error) => {
      console.error('[Janitor Voice] Consumer error:', error);
    };

    // Start playback (will wait for chunks from producer)
    const playbackPromise = consumer.play();

    // Store consumer so we can stop it if needed
    this.cinematicConsumer = consumer;

    // Wait for both to complete
    await Promise.all([generationPromise, playbackPromise]);
  }

  /**
   * Play with normal single-voice TTS (existing behavior)
   */
  playNormal(element, text, button) {
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

  setCinematicMode(enabled) {
    this.settings.cinematicMode = enabled;
    StorageManager.set('cinematicMode', enabled);
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
