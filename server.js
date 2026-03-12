// server.js (統合版: 生成モード & パターン解法モード)

const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
// 共通ユーティリティ & データロード
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

// データ構造
const filesMap = {
    'pokemon': ['pokemon.txt'],
    'countries': ['countries.txt'],
    'capitals': ['capitals.txt'],
    'countries_capitals': ['countries.txt', 'capitals.txt']
};

// ジェネレーター用 (シャッフル済み配列)
let indexedWordLists = {}; 
// ソルバー用 (MCV/LCV最適化データ)
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
                        uniqueWordsGen.add(rawWord); // Generator用
                        
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
                console.error(`- エラー: ${file} の読み込みに失敗しました。`, error.message);
            }
        }

        // ジェネレーター用インデックスの構築
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

        // ソルバー用インデックスの構築
        for (const length in wordsByLengthSolver[key]) {
            wordsByLengthSolver[key][length] = Array.from(wordsByLengthSolver[key][length]);
        }
        if (uniqueNormWordsSolver.size > 0) {
            buildIntersectionIndex(key);
            console.log(`- リスト [${key}]: 登録完了（重複排除済み）`);
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
                        const coord = `${nextR},${nextC}`;
                        if (nextR >= 0 && nextR < rows && nextC >= 0 && nextC < cols) {
                            if (grid[nextR][nextC] === ' ' && !visited[nextR][nextC]) {
                                visited[nextR][nextC] = true;
                                queue.push([nextR, nextC]);
                                currentBlock.add(coord);
                                if (nextR === 0 || nextR === rows - 1 || nextC === 0 || nextC === cols - 1) {
                                    isTouchingBoundary = true;
                                }
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
    for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[0].length; c++) {
            if (grid[r][c] === ' ') emptyCells++;
        }
    }
    const { count: isolatedBlocks, isolatedCells } = countIsolatedEmptyBlocks(grid);
    const baseScore = placedWords.length * 10000 - emptyCells; 
    const topologyBonus = isolatedBlocks * 10000000000; 

    const untouchedWords = getUntouchedWords(placedWords, isolatedCells);
    const touchedWordsCount = placedWords.length - untouchedWords.length;
    let contactBonus = 0;

    if (placedWords.length > 0) {
        contactBonus = (touchedWordsCount / placedWords.length) * 100000;
        if (untouchedWords.length === 0) contactBonus += 50000; 
    }
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
        } else {
            return bestSolution;
        }
    }
    
    const currentCandidates = {};
    for (const length in indexedWords) {
        currentCandidates[length] = shuffleArray([...indexedWords[length]]);
    }

    function findHookPoints(grid) {
        const centerR = rows / 2, centerC = cols / 2;
        const points = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (grid[r][c] !== ' ') {
                    points.push({ r, c, char: grid[r][c], distanceSq: Math.pow(r - centerR, 2) + Math.pow(c - centerC, 2) });
                }
            }
        }
        return points.sort((a, b) => b.distanceSq - a.distanceSq); 
    }

    function backtrack(currentGrid, usedWords, placedWords) {
        if (attemptCount++ > MAX_ATTEMPTS) return;

        const currentDensityScore = calculateDensityScore(currentGrid, placedWords);
        if (currentDensityScore > bestSolution.densityScore) {
            bestSolution = { grid: currentGrid.map(row => [...row]), placedWords: [...placedWords], score: placedWords.length, densityScore: currentDensityScore };
        }

        const hookPoints = findHookPoints(currentGrid);
        const isCurrentlyEmpty = placedWords.length === 0;

        for (const length of availableLengths) {
            const candidates = currentCandidates[length]; 
            if (!candidates) continue;

            for (const word of candidates) {
                if (usedWords.has(word)) continue;

                if (isCurrentlyEmpty) {
                    const centerR = Math.floor(rows / 2);
                    const centerC = Math.floor(cols / 2 - word.length / 2);
                    const directions = shuffleArray(['horizontal', 'vertical']);

                    for (const dir of directions) {
                        const placedGrid = placeWord(currentGrid, word, centerR, centerC, dir, true); 
                        if (placedGrid) {
                            usedWords.add(word);
                            placedWords.push({ word, r: centerR, c: centerC, direction: dir });
                            backtrack(placedGrid, usedWords, placedWords);
                            usedWords.delete(word);
                            placedWords.pop();
                            return; 
                        }
                    }
                    continue; 
                }

                for (const { r: hookR, c: hookC, char: hookChar } of hookPoints) {
                    for (let i = 0; i < word.length; i++) {
                        if (word[i] === hookChar) {
                            const directions = shuffleArray(['horizontal', 'vertical']);
                            for (const direction of directions) {
                                let startR = direction === 'horizontal' ? hookR : hookR - i;
                                let startC = direction === 'horizontal' ? hookC - i : hookC;
                                const newGrid = placeWord(currentGrid, word, startR, startC, direction, false); 

                                if (newGrid) {
                                    usedWords.add(word);
                                    placedWords.push({ word, r: startR, c: startC, direction });
                                    backtrack(newGrid, usedWords, placedWords);
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
    
    if (initialPlacedWords.length === 0) {
        const startLength = availableLengths[0];
        const startWords = indexedWords[startLength] || [];
        const startWord = startWords[Math.floor(Math.random() * startWords.length)];
        if (startWord) {
            const centerR = Math.floor(rows / 2);
            const centerC = Math.floor(cols / 2 - startWord.length / 2);
            const directions = shuffleArray(['horizontal', 'vertical']);
            for (const dir of directions) {
                const placedGrid = placeWord(initialGrid, startWord, centerR, centerC, dir, true); 
                if (placedGrid) {
                    initialUsed.add(startWord);
                    initialPlaced.push({ word: startWord, r: centerR, c: centerC, direction: dir });
                    backtrack(placedGrid, initialUsed, initialPlaced);
                    initialUsed.delete(startWord);
                    initialPlaced.pop();
                }
            }
        }
    } else {
        backtrack(initialGrid, initialUsed, initialPlaced);
    }
    return bestSolution;
}

// =========================================================
// 3. ソルバー (MCV/LCV パターン解法) ロジック
// =========================================================

function getWordSlots(pattern) {
    const rows = pattern.length;
    const cols = pattern[0].length;
    const wordSlots = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (pattern[r][c] === 1) {
                if ((c === 0 || pattern[r][c - 1] === 0) && (c < cols - 1 && pattern[r][c + 1] === 1)) {
                    let length = 0;
                    for (let i = c; i < cols; i++) {
                        if (pattern[r][i] === 1) length++; else break;
                    }
                    wordSlots.push({ index: wordSlots.length, position: { r, c }, direction: 'horizontal', length, intersections: [] });
                }
                if ((r === 0 || pattern[r - 1][c] === 0) && (r < rows - 1 && pattern[r + 1][c] === 1)) {
                    let length = 0;
                    for (let i = r; i < rows; i++) {
                        if (pattern[i][c] === 1) length++; else break;
                    }
                    wordSlots.push({ index: wordSlots.length, position: { r, c }, direction: 'vertical', length, intersections: [] });
                }
            }
        }
    }

    for (let i = 0; i < wordSlots.length; i++) {
        const slotA = wordSlots[i];
        for (let j = i + 1; j < wordSlots.length; j++) {
            const slotB = wordSlots[j];
            if (slotA.direction !== slotB.direction) {
                const horiz = slotA.direction === 'horizontal' ? slotA : slotB;
                const vert = slotA.direction === 'vertical' ? slotA : slotB;
                const vertStartR = vert.position.r;
                const vertEndR = vert.position.r + vert.length - 1;
                const horizStartC = horiz.position.c;
                const horizEndC = horiz.position.c + horiz.length - 1;
                const crossR_check = horiz.position.r;
                const crossC_check = vert.position.c;

                if (crossR_check >= vertStartR && crossR_check <= vertEndR &&
                    crossC_check >= horizStartC && crossC_check <= horizEndC) {
                    const posA = slotA.direction === 'horizontal' ? crossC_check - horizStartC : crossR_check - vertStartR;
                    const posB = slotB.direction === 'horizontal' ? crossC_check - horizStartC : crossR_check - vertStartR;
                    slotA.intersections.push({ otherSlotIndex: slotB.index, thisPos: posA, otherPos: posB });
                    slotB.intersections.push({ otherSlotIndex: slotA.index, thisPos: posB, otherPos: posA });
                }
            }
        }
    }
    return wordSlots;
}

function solveCrossword(pattern, optimizedData, listUsedName) {
    const { wordsByLength, intersectionIndex } = optimizedData;
    const wordSlots = getWordSlots(pattern);
    const numSlots = wordSlots.length;

    const assignments = Array(numSlots).fill(null);
    const usedWordsSet = new Set();
    const solutions = [];

    function filterCandidates(slot, currentGrid, lengthMap) {
        const allCandidates = lengthMap[slot.length] || [];
        return allCandidates.filter(word => {
            if (usedWordsSet.has(word)) return false;
            if (slot.direction === 'horizontal') {
                for (let i = 0; i < slot.length; i++) {
                    const cell = currentGrid[slot.position.r][slot.position.c + i];
                    if (cell !== '' && cell !== word[i]) return false;
                }
            } else {
                for (let i = 0; i < slot.length; i++) {
                    const cell = currentGrid[slot.position.r + i][slot.position.c];
                    if (cell !== '' && cell !== word[i]) return false;
                }
            }
            return true;
        });
    }

    function selectNextSlot(currentGrid) {
        let bestIndex = -1;
        let minCandidates = Infinity;
        for (let i = 0; i < numSlots; i++) {
            if (assignments[i] === null) {
                const slot = wordSlots[i];
                const candidates = filterCandidates(slot, currentGrid, wordsByLength[listUsedName]);
                if (candidates.length < minCandidates) {
                    minCandidates = candidates.length;
                    bestIndex = i;
                }
            }
        }
        return bestIndex;
    }

    function getSortedCandidates(slot, currentGrid) {
        const allCandidates = wordsByLength[listUsedName][slot.length] || [];
        return allCandidates.filter(word => {
            if (usedWordsSet.has(word)) return false;
            if (slot.direction === 'horizontal') {
                for (let i = 0; i < slot.length; i++) {
                    const cell = currentGrid[slot.position.r][slot.position.c + i];
                    if (cell !== '' && cell !== word[i]) return false;
                }
            } else { 
                for (let i = 0; i < slot.length; i++) {
                    const cell = currentGrid[slot.position.r + i][slot.position.c];
                    if (cell !== '' && cell !== word[i]) return false;
                }
            }
            return true;
        });
    }

    function backtrack(currentGrid) {
        if (solutions.length >= 10) return; // UI向けに解を10個で打ち切り

        const slotIndex = selectNextSlot(currentGrid);
        if (slotIndex === -1) {
            solutions.push(currentGrid.map(row => [...row]));
            return;
        }

        const slot = wordSlots[slotIndex];
        const candidates = getSortedCandidates(slot, currentGrid);

        for (const word of candidates) {
            let tempGrid = currentGrid.map(row => [...row]);
            if (slot.direction === 'horizontal') {
                for (let i = 0; i < slot.length; i++) tempGrid[slot.position.r][slot.position.c + i] = word[i];
            } else { 
                for (let i = 0; i < slot.length; i++) tempGrid[slot.position.r + i][slot.position.c] = word[i];
            }

            assignments[slotIndex] = word;
            usedWordsSet.add(word);
            backtrack(tempGrid);
            assignments[slotIndex] = null;
            usedWordsSet.delete(word);
        }
    }

    const initialGrid = Array.from({ length: pattern.length }, () => Array(pattern[0].length).fill(''));
    backtrack(initialGrid);
    return solutions;
}

// =========================================================
// 4. API エンドポイント
// =========================================================

// 動的生成API
app.post('/generate', (req, res) => {
    const { rows, cols, listName } = req.body; 
    if (!rows || !cols || rows < 5 || cols < 5 || rows > 20 || cols > 20) {
        return res.status(400).send({ error: '縦横のマス目の数は5から20の間で指定してください。' });
    }

    const listUsedName = listName in indexedWordLists ? listName : 'pokemon';
    const currentWordList = indexedWordLists[listUsedName];
    
    let currentBestResult = { grid: createEmptyGrid(rows, cols), placedWords: [], score: 0, densityScore: -Infinity };
    const NUM_RESTARTS = 30;
    const MAX_REPLACEMENT_ROUNDS = 5;
    let finalResult = null;

    for (let i = 0; i < NUM_RESTARTS; i++) {
        const result = generateCrossword(rows, cols, currentWordList);
        if (result.densityScore > currentBestResult.densityScore) currentBestResult = result;
    }

    let rounds = 0;
    while (rounds < MAX_REPLACEMENT_ROUNDS) {
        rounds++;
        const { isolatedCells } = countIsolatedEmptyBlocks(currentBestResult.grid);
        const untouchedWords = getUntouchedWords(currentBestResult.placedWords, isolatedCells);

        if (untouchedWords.length === 0) {
            finalResult = currentBestResult;
            break;
        }
        if (untouchedWords.length === currentBestResult.placedWords.length) break;

        const wordsToKeep = currentBestResult.placedWords.filter(pWord => !untouchedWords.includes(pWord));
        let restartResult = { densityScore: -Infinity };
        for (let i = 0; i < 5; i++) { 
            const result = generateCrossword(rows, cols, currentWordList, wordsToKeep);
            if (result.densityScore > restartResult.densityScore) restartResult = result;
        }
        if (restartResult.densityScore > currentBestResult.densityScore) {
            currentBestResult = restartResult;
        } else {
            break;
        }
    }

    const resultToDisplay = finalResult || currentBestResult;
    const { isolatedCells } = countIsolatedEmptyBlocks(resultToDisplay.grid);
    const finalUntouchedWords = getUntouchedWords(resultToDisplay.placedWords, isolatedCells);

    if (isolatedCells.size === 0 || finalUntouchedWords.length > 0) {
        const warning = finalUntouchedWords.length > 0
            ? "全ての単語を孤立ブロックに接させることができませんでした。不合格な単語が残っています。"
            : "要件を満たす孤立した空きマス塊のあるパズルが見つかりませんでした。";
        return res.json({
            grid: createEmptyGrid(rows, cols).map(row => row.map(cell => cell === ' ' ? '⬛︎' : cell)),
            placedWords: [], score: 0, listUsed: listUsedName, warning: warning
        });
    }

    const finalGrid = resultToDisplay.grid.map(row => row.map(cell => cell === ' ' ? '⬛︎' : cell));
    res.json({ grid: finalGrid, placedWords: resultToDisplay.placedWords, score: resultToDisplay.score, listUsed: listUsedName });
});

// パターン解法API
app.post('/solve', (req, res) => {
    const { pattern, listName } = req.body;
    if (!pattern || !Array.isArray(pattern)) {
        return res.status(400).send({ error: '無効なパターンデータです。' });
    }

    const listUsedName = listName in wordsByLengthSolver ? listName : 'pokemon';
    const optimizedData = { wordsByLength: wordsByLengthSolver, intersectionIndex };
    
    console.log(`パターン解法開始: リスト=${listUsedName}, サイズ=${pattern.length}x${pattern[0].length}`);
    const solutions = solveCrossword(pattern, optimizedData, listUsedName);
    
    if (solutions.length === 0) {
        return res.json({ solutions: [], warning: "このパターンと単語リストで解が見つかりませんでした。" });
    }

    // クライアント表示用にフォーマット（空白を '⬛︎' に変換）
    const formattedSolutions = solutions.map(sol => 
        sol.map(row => row.map(cell => cell === '' ? '⬛︎' : cell))
    );

    res.json({ solutions: formattedSolutions, listUsed: listUsedName });
});

app.listen(port, () => {
    console.log(`統合サーバーが起動しました 🚀`);
    console.log(`ブラウザで http://localhost:${port}/ にアクセスしてください`);
});