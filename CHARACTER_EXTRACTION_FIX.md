# Character Extraction Fix (Phase 2A) - Strict Mode

## Overview
Replaced the fragile character extraction logic with a robust, multi-strategy system employing **Strict Filtering**. This ensures accurate name detection and elimination of noise like "Say", "Well", or "Madison's".

## Strategies Implemented

### 1. Primary: DOM Inspection
scans the visible page for character lists.
- **Pattern:** Looks for "Name, Name, Name" sequences in headers/descriptions.
- **Heuristic:** If >50% of comma-separated parts look like names, it captures the whole list.
- **Fallback:** Checks generic headers (H1/H2) and known card titles.
- **Possessive Cleaning:** Removes trailing `'s` from header names.

### 2. Secondary: Strict Text Analysis
If DOM fails, analyzes the story text itself with a multi-stage pipeline.

#### A. Tokenization & Cleaning
- **Split:** Breaks text on non-letter characters (preserving apostrophes).
- **Possessive Stripping:** "Madison's" -> "Madison", "Boys'" -> "Boy".
- **Shape Check:** Must start with Capital, Length >= 3, not ALL CAPS.

#### B. Stopword Filtering
Aggressively blocks non-names via an expanded blocklist:
- **Pronouns:** He, She, They, His, Her...
- **Dialogue Starters:** Say, Says, Said, Well, Oh, Ah, Hmm...
- **Common Words:** But, And, So, If, When, Now, Just...

#### C. Frequency Thresholding
- **Standard Rule:** Name must appear **>= 2 times**.
- **Short Text Exception:** If text < 300 chars, allow single occurrence (>= 1).

### 3. Cleaning
- Removes generic terms (Narrator, Voice, System).
- Dedupes results.
- Preserves capitalization.

## Verification
The system now outputs detailed logs:
```
[Janitor Voice] Candidate Frequencies: { Madison: 5, Jack: 3, Emily: 2 }
[Janitor Voice] Extracted characters (3): ["Jack", "Emily", "Madison"]
```

This unblocks Phase 3 (Voice Assignment) and Phase 4 (Audio Generation).
