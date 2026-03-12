// server.js (統合版: 生成モード & パターン解法モード)
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
// 1. 共通ユーティリティ & データロード
// =========================================================

function normalizeWord(word) {
    const replacements = {
        'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ',
        'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ッ': 'ツ',
        'ぁ': 'ア', 'ぃ': 'イ', 'ぅ': 'ウ', 'ぇ': 'エ', 'ぉ': 'オ',
        'ゃ': 'ヤ', 'ゅ': 'ユ', 'ょ': 'ヨ', '・': ''
    };
    let normalizedWord = '';
    for (const char of word) {
        normalizedWord += replacements[char] || char;
    }
    return normalizedWord;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

const filesMap = {
    'pokemon': ['pokemon.txt'],
    'countries': ['countries.txt'],
    'capitals': ['capitals.txt'],
    'countries_capitals': ['countries.txt', 'capitals.txt']
};

let indexedWordLists = {}; 
const wordsByLengthSolver = {};
const intersectionIndex = {};

function buildIntersectionIndex(key) {
    const listWordsByLength = wordsByLengthSolver[key];
    const index = intersectionIndex[key];
    for (const length in listWordsByLength) {
        index[length] = {};
        const words = listWordsByLength[length];
        for (let pos = 0; pos < parseInt(length); pos++) {
            index[length][pos] = {};
            for (const word of words) {
                const char = word[pos];
                if (!index[length][pos][char]) index[length][pos][char] = new Set();
                index[length][pos][char].add(word);
            }
        }
    }
}

function loadAndOptimizeWordLists() {
    console.log("単語リストを読み込み、最適化中...");
    for (const key in filesMap) {
        const fileList = filesMap[key];
        const uniqueWordsGen = new Set();
        const uniqueNormWordsSolver = new Set();
        wordsByLengthSolver[key] = {};
        intersectionIndex[key] = {};

        for (const file of fileList) {
            const filePath = path.join(__dirname, file); 
            try {
                if (fs.existsSync(filePath)) {
                    const rawWords = fs.readFileSync(filePath, 'utf8')
                                    .split('\n').map(s => s.trim()).filter(s => s.length > 0);
                    for (const rawWord of rawWords) {
                        uniqueWordsGen.add(rawWord);
                        const normWord = normalizeWord(rawWord);
                        if (normWord.length < 2) continue;
                        if (!wordsByLengthSolver[key][normWord.length]) {
                            wordsByLengthSolver[key][normWord.length] = new Set();
                        }
                        wordsByLengthSolver[key][normWord.length].add(normWord);
                        uniqueNormWordsSolver.add(normWord);
                    }
                }
            } catch (error) {
                console.error(`- エラー: ${file} 読み込み失敗:`, error.message);
            }
        }

        if (uniqueWordsGen.size > 0) {
            const indexed = {};
            for (const rawWord of Array.from(uniqueWordsGen)) {
                const word = normalizeWord(rawWord);
                if (word.length < 2) continue;
                if (!indexed[word.length]) indexed[word.length] = new Set();
                indexed[word.length].add(word);
            }
            for (const length in indexed) {
                indexed[length] = shuffleArray(Array.from(indexed[length])); 
            }
            indexedWordLists[key] = indexed;
        }

        for (const length in wordsByLengthSolver[key]) {
            wordsByLengthSolver[key][length] = Array.from(wordsByLengthSolver[key][length]);
        }
        if (uniqueNormWordsSolver.size > 0) {
            buildIntersectionIndex(key);
            console.log(`- [${key}]: ロード完了 (${uniqueWordsGen.size}語)`);
        }
    }
}
loadAndOptimizeWordLists();

// =========================================================
// 2. ジェネレーター (動的生成) ロジック
// =========================================================

function createEmptyGrid(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(' '));
}

function placeWord(grid, word, r, c, direction, isFirstWord) {
    const rows = grid.length, cols = grid[0].length, length = word.length;
    const newGrid = grid.map(row => [...row]); 
    let intersectionCount = 0;

    for (let i = 0; i < length; i++) {
        let currentR = r + (direction === 'vertical' ? i : 0);
        let currentC = c + (direction === 'horizontal' ? i : 0);
        if (currentR < 0 || currentR >= rows || currentC < 0 || currentC >= cols) return null;
        const existingChar = newGrid[currentR][currentC];
        if (existingChar !== ' ' && existingChar !== word[i]) return null;
        if (existingChar === word[i]) intersectionCount++;
        if (existingChar === ' ') {
            if (direction === 'horizontal') {
                if ((currentR > 0 && newGrid[currentR - 1][currentC] !== ' ') || 
                    (currentR < rows - 1 && newGrid[currentR + 1][currentC] !== ' ')) return null;
            } else { 
                if ((currentC > 0 && newGrid[currentR][currentC - 1] !== ' ') || 
                    (currentC < cols - 1 && newGrid[currentR][currentC + 1] !== ' ')) return null;
            }
        }
        newGrid[currentR][currentC] = word[i];
    }
    const endR = r + (direction === 'vertical' ? length : 0), endC = c + (direction === 'horizontal' ? length : 0);
    const startR = r - (direction === 'vertical' ? 1 : 0), startC = c - (direction === 'horizontal' ? 1 : 0);
    if (startR >= 0 && startR < rows && startC >= 0 && startC < cols && newGrid[startR][startC] !== ' ') return null;
    if (endR >= 0 && endR < rows && endC >= 0 && endC < cols && newGrid[endR][endC] !== ' ') return null;
    if (intersectionCount === 0 && !isFirstWord) return null; 
    return newGrid;
}

function countIsolatedEmptyBlocks(grid) {
    const rows = grid.length, cols = grid[0].length;
    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));
    let isolatedBlockCount = 0;
    const isolatedCells = new Set(); 
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (grid[r][c] === ' ' && !visited[r][c]) {
                let isTouchingBoundary = false;
                const queue = [[r, c]];
                visited[r][c] = true;
                const currentBlock = new Set();
                if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) isTouchingBoundary = true;
                currentBlock.add(`${r},${c}`);
                let head = 0;
                while (head < queue.length) {
                    const [currR, currC] = queue[head++];
                    for (const [dr, dc] of directions) {
                        const nextR = currR + dr, nextC = currC + dc;
                        if (nextR >= 0 && nextR < rows && nextC >= 0 && nextC < cols) {
                            if (grid[nextR][nextC] === ' ' && !visited[nextR][nextC]) {
                                visited[nextR][nextC] = true;
                                queue.push([nextR, nextC]);
                                currentBlock.add(`${nextR},${nextC}`);
                                if (nextR === 0 || nextR === rows - 1 || nextC === 0 || nextC === cols - 1) isTouchingBoundary = true;
                            }
                        }
                    }
                }
                if (!isTouchingBoundary) {
                    isolatedBlockCount++;
                    currentBlock.forEach(cell => isolatedCells.add(cell));
                }
            }
        }
    }
    return { count: isolatedBlockCount, isolatedCells };
}

function getUntouchedWords(placedWords, isolatedCells) {
    if (isolatedCells.size === 0) return placedWords;
    const untouchedWords = [];
    const adjacencies = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const pWord of placedWords) {
        let isTouching = false;
        for (let i = 0; i < pWord.word.length; i++) {
            let r = pWord.r + (pWord.direction === 'vertical' ? i : 0);
            let c = pWord.c + (pWord.direction === 'horizontal' ? i : 0);
            for (const [dr, dc] of adjacencies) {
                if (isolatedCells.has(`${r + dr},${c + dc}`)) { isTouching = true; break; }
            }
            if (isTouching) break; 
        }
        if (!isTouching) untouchedWords.push(pWord);
    }
    return untouchedWords;
}

function calculateDensityScore(grid, placedWords) {
    let emptyCells = 0;
    for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[0].length; c++) if (grid[r][c] === ' ') emptyCells++;
    }
    const { count: isolatedBlocks, isolatedCells } = countIsolatedEmptyBlocks(grid);
    const baseScore = placedWords.length * 10000 - emptyCells; 
    const topologyBonus = isolatedBlocks * 10000000000; 
    const untouchedWords = getUntouchedWords(placedWords, isolatedCells);
    const touchedWordsCount = placedWords.length - untouchedWords.length;
    let contactBonus = placedWords.length > 0 ? (touchedWordsCount / placedWords.length) * 100000 : 0;
    if (untouchedWords.length === 0 && placedWords.length > 0) contactBonus += 50000; 
    return topologyBonus + baseScore + contactBonus; 
}

function generateCrossword(rows, cols, indexedWords, initialPlacedWords = []) {
    const MAX_ATTEMPTS = 15000; 
    let attemptCount = 0;
    const availableLengths = Object.keys(indexedWords).map(Number).sort((a, b) => b - a).sort(() => Math.random() - 0.5); 
    let bestSolution = { grid: createEmptyGrid(rows, cols), placedWords: [], score: 0, densityScore: -Infinity };
    let initialGrid = createEmptyGrid(rows, cols), initialUsed = new Set(), initialPlaced = [];

    for (const pWord of initialPlacedWords) {
        const pg = placeWord(initialGrid, pWord.word, pWord.r, pWord.c, pWord.direction, true);
        if (pg) { initialGrid = pg; initialUsed.add(pWord.word); initialPlaced.push(pWord); }
        else return bestSolution;
    }
    
    function backtrack(currentGrid, usedWords, placedWords) {
        if (attemptCount++ > MAX_ATTEMPTS) return;
        const currentDensityScore = calculateDensityScore(currentGrid, placedWords);
        if (currentDensityScore > bestSolution.densityScore) {
            bestSolution = { grid: currentGrid.map(row => [...row]), placedWords: [...placedWords], score: placedWords.length, densityScore: currentDensityScore };
        }
        const hookPoints = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) if (currentGrid[r][c] !== ' ') hookPoints.push({ r, c, char: currentGrid[r][c] });
        }
        shuffleArray(hookPoints);

        for (const length of availableLengths) {
            const candidates = indexedWords[length]; 
            if (!candidates) continue;
            for (const word of candidates) {
                if (usedWords.has(word)) continue;
                if (placedWords.length === 0) {
                    const sR = Math.floor(rows/2), sC = Math.floor(cols/2 - word.length/2);
                    for (const dir of shuffleArray(['horizontal', 'vertical'])) {
                        const pg = placeWord(currentGrid, word, sR, sC, dir, true);
                        if (pg) {
                            usedWords.add(word); placedWords.push({ word, r: sR, c: sC, direction: dir });
                            backtrack(pg, usedWords, placedWords);
                            usedWords.delete(word); placedWords.pop();
                            return;
                        }
                    }
                } else {
                    for (const hp of hookPoints) {
                        for (let i = 0; i < word.length; i++) {
                            if (word[i] === hp.char) {
                                for (const dir of shuffleArray(['horizontal', 'vertical'])) {
                                    let sR = dir === 'horizontal' ? hp.r : hp.r - i, sC = dir === 'horizontal' ? hp.c - i : hp.c;
                                    const ng = placeWord(currentGrid, word, sR, sC, dir, false); 
                                    if (ng) {
                                        usedWords.add(word); placedWords.push({ word, r: sR, c: sC, direction: dir });
                                        backtrack(ng, usedWords, placedWords);
                                        usedWords.delete(word); placedWords.pop();
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    backtrack(initialGrid, initialUsed, initialPlaced);
    return bestSolution;
}

// =========================================================
// 3. ソルバー (MCV/LCV パターン解法) ロジック
// =========================================================

function getWordSlots(pattern) {
    const rows = pattern.length, cols = pattern[0].length, wordSlots = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (pattern[r][c] === 1) {
                if ((c === 0 || pattern[r][c - 1] === 0) && (c < cols - 1 && pattern[r][c + 1] === 1)) {
                    let len = 0; for (let i = c; i < cols; i++) if (pattern[r][i] === 1) len++; else break;
                    wordSlots.push({ index: wordSlots.length, position: { r, c }, direction: 'horizontal', length: len });
                }
                if ((r === 0 || pattern[r - 1][c] === 0) && (r < rows - 1 && pattern[r + 1][c] === 1)) {
                    let len = 0; for (let i = r; i < rows; i++) if (pattern[i][c] === 1) len++; else break;
                    wordSlots.push({ index: wordSlots.length, position: { r, c }, direction: 'vertical', length: len });
                }
            }
        }
    }
    return wordSlots;
}

function solveCrossword(pattern, listUsedName) {
    const wordSlots = getWordSlots(pattern);
    const numSlots = wordSlots.length, assignments = Array(numSlots).fill(null);
    const usedWordsSet = new Set(), solutions = [];

    function backtrack(currentGrid) {
        if (solutions.length >= 10) return; 
        let bestIndex = -1, minCand = Infinity;
        for (let i = 0; i < numSlots; i++) {
            if (assignments[i] === null) {
                const slot = wordSlots[i];
                const cands = (wordsByLengthSolver[listUsedName][slot.length] || []).filter(word => {
                    if (usedWordsSet.has(word)) return false;
                    for (let j = 0; j < slot.length; j++) {
                        const r = slot.position.r + (slot.direction === 'vertical' ? j : 0);
                        const c = slot.position.c + (slot.direction === 'horizontal' ? j : 0);
                        if (currentGrid[r][c] !== '' && currentGrid[r][c] !== word[j]) return false;
                    }
                    return true;
                });
                if (cands.length < minCand) { minCand = cands.length; bestIndex = i; }
            }
        }
        if (bestIndex === -1) { solutions.push(currentGrid.map(row => [...row])); return; }
        const slot = wordSlots[bestIndex];
        const candidates = (wordsByLengthSolver[listUsedName][slot.length] || []).filter(word => {
            if (usedWordsSet.has(word)) return false;
            for (let j = 0; j < slot.length; j++) {
                const r = slot.position.r + (slot.direction === 'vertical' ? j : 0);
                const c = slot.position.c + (slot.direction === 'horizontal' ? j : 0);
                if (currentGrid[r][c] !== '' && currentGrid[r][c] !== word[j]) return false;
            }
            return true;
        });
        for (const word of candidates) {
            let tempGrid = currentGrid.map(row => [...row]);
            for (let j = 0; j < slot.length; j++) {
                const r = slot.position.r + (slot.direction === 'vertical' ? j : 0);
                const c = slot.position.c + (slot.direction === 'horizontal' ? j : 0);
                tempGrid[r][c] = word[j];
            }
            assignments[bestIndex] = word; usedWordsSet.add(word);
            backtrack(tempGrid);
            assignments[bestIndex] = null; usedWordsSet.delete(word);
        }
    }
    backtrack(Array.from({ length: pattern.length }, () => Array(pattern[0].length).fill('')));
    return solutions;
}

// =========================================================
// 4. API エンドポイント
// =========================================================

app.post('/generate', (req, res) => {
    const { rows, cols, listName } = req.body; 
    const listUsedName = listName in indexedWordLists ? listName : 'pokemon';
    let currentBest = { grid: createEmptyGrid(rows, cols), densityScore: -Infinity };
    for (let i = 0; i < 30; i++) {
        const result = generateCrossword(rows, cols, indexedWordLists[listUsedName]);
        if (result.densityScore > currentBest.densityScore) currentBest = result;
    }
    const finalGrid = currentBest.grid.map(row => row.map(cell => cell === ' ' ? '⬛︎' : cell));
    res.json({ grid: finalGrid, placedWords: currentBest.placedWords, score: currentBest.score });
});

app.post('/solve', (req, res) => {
    const { pattern, listName } = req.body;
    const listUsedName = listName in wordsByLengthSolver ? listName : 'pokemon';
    const solutions = solveCrossword(pattern, listUsedName);
    const formatted = solutions.map(sol => sol.map(row => row.map(cell => cell === '' ? '⬛︎' : cell)));
    res.json({ solutions: formatted });
});

app.listen(port, () => console.log(`🚀 サーバー起動: http://localhost:${port}`));