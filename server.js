// generator.js (Renderデプロイ対応・重複排除版)
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// Render等の環境変数からポートを取得、なければ3000を使用
const port = process.env.PORT || 3000;

// =========================================================
// 1. コアロジック (クロスワード生成アルゴリズム)
// =========================================================

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

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

function indexWords(rawWords) {
    const indexed = {};
    for (const rawWord of rawWords) {
        const word = normalizeWord(rawWord);
        if (word.length < 2) continue;
        if (!indexed[word.length]) {
            indexed[word.length] = new Set();
        }
        indexed[word.length].add(word);
    }
    for (const length in indexed) {
        indexed[length] = shuffleArray(Array.from(indexed[length])); 
    }
    return indexed;
}

function createEmptyGrid(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(' '));
}

function placeWord(grid, word, r, c, direction, isFirstWord) {
    const rows = grid.length;
    const cols = grid[0].length;
    const length = word.length;
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
    
    const endR = r + (direction === 'vertical' ? length : 0);
    const endC = c + (direction === 'horizontal' ? length : 0);
    const startR = r - (direction === 'vertical' ? 1 : 0);
    const startC = c - (direction === 'horizontal' ? 1 : 0);

    if (startR >= 0 && startR < rows && startC >= 0 && startC < cols && newGrid[startR][startC] !== ' ') return null;
    if (endR >= 0 && endR < rows && endC >= 0 && endC < cols && newGrid[endR][endC] !== ' ') return null;

    if (intersectionCount === 0 && !isFirstWord) return null; 
    return newGrid;
}

function countIsolatedEmptyBlocks(grid) {
    const rows = grid.length;
    const cols = grid[0].length;
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
                        const nextR = currR + dr;
                        const nextC = currC + dc;
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
    const untouchedWords = [];
    if (isolatedCells.size === 0) return placedWords;
    const adjacencies = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    
    for (const pWord of placedWords) {
        let isTouching = false;
        for (let i = 0; i < pWord.word.length; i++) {
            let r = pWord.r + (pWord.direction === 'vertical' ? i : 0);
            let c = pWord.c + (pWord.direction === 'horizontal' ? i : 0);
            for (const [dr, dc] of adjacencies) {
                if (isolatedCells.has(`${r + dr},${c + dc}`)) {
                    isTouching = true;
                    break;
                }
            }
            if (isTouching) break; 
        }
        if (!isTouching) untouchedWords.push(pWord);
    }
    return untouchedWords;
}

function calculateDensityScore(grid, placedWords) {
    let emptyCells = 0;
    const { count: isolatedBlocks, isolatedCells } = countIsolatedEmptyBlocks(grid);
    for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[0].length; c++) {
            if (grid[r][c] === ' ') emptyCells++;
        }
    }
    const baseScore = placedWords.length * 10000 - emptyCells; 
    const topologyBonus = isolatedBlocks * 10000000000; 
    const untouchedWords = getUntouchedWords(placedWords, isolatedCells);
    const touchedWordsCount = placedWords.length - untouchedWords.length;
    let contactBonus = placedWords.length > 0 ? (touchedWordsCount / placedWords.length) * 100000 : 0;
    if (placedWords.length > 0 && untouchedWords.length === 0) contactBonus += 50000; 
    
    return topologyBonus + baseScore + contactBonus; 
}

function generateCrossword(rows, cols, indexedWords, initialPlacedWords = []) {
    const MAX_ATTEMPTS = 150000; 
    let attemptCount = 0;
    const availableLengths = Object.keys(indexedWords).map(Number).sort((a, b) => b - a).sort(() => Math.random() - 0.5); 
    let bestSolution = { grid: createEmptyGrid(rows, cols), placedWords: [], score: 0, densityScore: -Infinity };
    
    let initialGrid = createEmptyGrid(rows, cols);
    let initialUsed = new Set();
    let initialPlaced = [];

    for (const pWord of initialPlacedWords) {
        const placedGrid = placeWord(initialGrid, pWord.word, pWord.r, pWord.c, pWord.direction, true);
        if (placedGrid) {
            initialGrid = placedGrid;
            initialUsed.add(pWord.word);
            initialPlaced.push(pWord);
        }
    }
    
    const currentCandidates = {};
    for (const length in indexedWords) currentCandidates[length] = shuffleArray([...indexedWords[length]]);

    function findHookPoints(grid) {
        const rMax = grid.length, cMax = grid[0].length;
        const centerR = rMax / 2, centerC = cMax / 2;
        const points = [];
        for (let r = 0; r < rMax; r++) {
            for (let c = 0; c < cMax; c++) {
                if (grid[r][c] !== ' ') {
                    const distanceSq = Math.pow(r - centerR, 2) + Math.pow(c - centerC, 2);
                    points.push({ r, c, char: grid[r][c], distanceSq });
                }
            }
        }
        return points.sort((a, b) => b.distanceSq - a.distanceSq); 
    }

    function backtrack(currentGrid, usedWords, placedWords) {
        if (attemptCount++ > MAX_ATTEMPTS) return;
        const currentDensityScore = calculateDensityScore(currentGrid, placedWords);
        if (currentDensityScore > bestSolution.densityScore) {
            bestSolution = { 
                grid: currentGrid.map(row => [...row]), 
                placedWords: [...placedWords], 
                score: placedWords.length,
                densityScore: currentDensityScore
            };
        }
        const hookPoints = findHookPoints(currentGrid);
        if (placedWords.length === 0) {
            const startLength = availableLengths[0];
            const startWord = (currentCandidates[startLength] || [])[0];
            if (startWord) {
                const centerR = Math.floor(rows / 2), centerC = Math.floor(cols / 2 - startWord.length / 2);
                for (const dir of shuffleArray(['horizontal', 'vertical'])) {
                    const pg = placeWord(currentGrid, startWord, centerR, centerC, dir, true);
                    if (pg) {
                        usedWords.add(startWord);
                        placedWords.push({ word: startWord, r: centerR, c: centerC, direction: dir });
                        backtrack(pg, usedWords, placedWords);
                        usedWords.delete(startWord);
                        placedWords.pop();
                        return;
                    }
                }
            }
            return;
        }

        for (const length of availableLengths) {
            for (const word of currentCandidates[length]) {
                if (usedWords.has(word)) continue;
                for (const { r: hR, c: hC, char: hChar } of hookPoints) {
                    for (let i = 0; i < word.length; i++) {
                        if (word[i] === hChar) {
                            for (const dir of shuffleArray(['horizontal', 'vertical'])) {
                                const sR = dir === 'horizontal' ? hR : hR - i;
                                const sC = dir === 'horizontal' ? hC - i : hC;
                                const ng = placeWord(currentGrid, word, sR, sC, dir, false);
                                if (ng) {
                                    usedWords.add(word);
                                    placedWords.push({ word, r: sR, c: sC, direction: dir });
                                    backtrack(ng, usedWords, placedWords);
                                    usedWords.delete(word);
                                    placedWords.pop();
                                    return;
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
// 2. サーバーの設定 (重複排除・マルチファイル読み込み)
// =========================================================

const filesMap = {
    'pokemon': ['pokemon.txt'],
    'countries': ['countries.txt'],
    'capitals': ['capitals.txt'],
    'countries_capitals': ['countries.txt', 'capitals.txt']
};
let indexedWordLists = {}; 

function loadAndIndexWords() {
    for (const key in filesMap) {
        const uniqueWords = new Set();
        for (const file of filesMap[key]) {
            const filePath = path.join(__dirname, file); 
            if (fs.existsSync(filePath)) {
                fs.readFileSync(filePath, 'utf8').split('\n').map(s => s.trim()).filter(s => s.length > 0).forEach(w => uniqueWords.add(w));
            }
        }
        if (uniqueWords.size > 0) indexedWordLists[key] = indexWords(Array.from(uniqueWords));
    }
    console.log("単語リストの準備が完了しました。");
}

loadAndIndexWords(); 

app.use(express.json());
app.use(express.static(__dirname));

app.post('/generate', (req, res) => {
    const { rows, cols, listName } = req.body; 
    if (!rows || !cols || rows < 5 || cols < 5 || rows > 20 || cols > 20) {
        return res.status(400).send({ error: '5x5から20x20の範囲で指定してください。' });
    }

    const listUsedName = listName in indexedWordLists ? listName : 'pokemon';
    const currentWordList = indexedWordLists[listUsedName];
    
    let currentBestResult = { grid: createEmptyGrid(rows, cols), placedWords: [], score: 0, densityScore: -Infinity };
    const NUM_RESTARTS = 15;

    for (let i = 0; i < NUM_RESTARTS; i++) {
        const result = generateCrossword(rows, cols, currentWordList);
        if (result.densityScore > currentBestResult.densityScore) currentBestResult = result;
    }

    const { isolatedCells } = countIsolatedEmptyBlocks(currentBestResult.grid);
    const finalUntouchedWords = getUntouchedWords(currentBestResult.placedWords, isolatedCells);

    if (isolatedCells.size === 0 || finalUntouchedWords.length > 0) {
        return res.json({
            grid: createEmptyGrid(rows, cols).map(row => row.map(() => '⬛︎')),
            placedWords: [],
            score: 0,
            listUsed: listUsedName,
            warning: "条件に合うパズルを生成できませんでした。もう一度お試しください。"
        });
    }
    
    res.json({
        grid: currentBestResult.grid.map(row => row.map(cell => cell === ' ' ? '⬛︎' : cell)),
        placedWords: currentBestResult.placedWords,
        score: currentBestResult.score,
        listUsed: listUsedName
    });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});