// server.js
// 統合版: 通常生成モード & 密集優先生成モード & パターン解法モード(高速化版)

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

    // カタカナと長音以外(♀ ♂ : . 数字 英字など)は除去
    return normalizedWord.replace(/[^ァ-ヶー]/g, '');
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [array[i], array[j]] = [array[j], array[i]];
    }

    return array;
}

const filesMap = {
    pokemon: ['pokemon.txt'],
    countries: ['countries.txt'],
    capitals: ['capitals.txt'],
    countries_capitals: ['countries.txt', 'capitals.txt']
};

// ジェネレーター用
let indexedWordLists = {};

// ソルバー用
const wordsByLengthSolver = {};

// ソルバー用: 長さ → 位置 → 文字 → ビットセット
const solverIndex = {};

// 密集生成用: フック文字ごとの単語インデックス
const denseWordIndex = {};

function loadAndOptimizeWordLists() {
    console.log('単語リストを読み込み、最適化中...');

    for (const key in filesMap) {
        const fileList = filesMap[key];

        const uniqueWordsGen = new Set();

        wordsByLengthSolver[key] = {};

        for (const file of fileList) {
            const filePath = path.join(__dirname, file);

            try {
                if (fs.existsSync(filePath)) {
                    const rawWords = fs.readFileSync(filePath, 'utf8')
                        .split('\n')
                        .map(s => s.trim())
                        .filter(s => s.length > 0);

                    for (const rawWord of rawWords) {
                        uniqueWordsGen.add(rawWord);

                        const normWord = normalizeWord(rawWord);

                        if (normWord.length < 2) continue;

                        if (!wordsByLengthSolver[key][normWord.length]) {
                            wordsByLengthSolver[key][normWord.length] = new Set();
                        }

                        wordsByLengthSolver[key][normWord.length].add(normWord);
                    }
                }
            } catch (error) {
                console.error(`- エラー: ${file} の読み込みに失敗しました。`, error.message);
            }
        }

        // ジェネレーター用インデックス
        if (uniqueWordsGen.size > 0) {
            const indexed = {};

            for (const rawWord of Array.from(uniqueWordsGen)) {
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

            indexedWordLists[key] = indexed;
        }

        // ソルバー用: Set → Array
        for (const length in wordsByLengthSolver[key]) {
            wordsByLengthSolver[key][length] = Array.from(wordsByLengthSolver[key][length]);
        }

        console.log(`- リスト [${key}]: 登録完了`);
    }
}

function buildDenseWordIndex() {
    for (const listName in indexedWordLists) {
        denseWordIndex[listName] = {};

        for (const length in indexedWordLists[listName]) {
            const words = indexedWordLists[listName][length];

            for (const word of words) {
                for (let pos = 0; pos < word.length; pos++) {
                    const char = word[pos];

                    if (!denseWordIndex[listName][char]) {
                        denseWordIndex[listName][char] = [];
                    }

                    denseWordIndex[listName][char].push({
                        word,
                        pos,
                        length: word.length
                    });
                }
            }
        }
    }

    console.log('- 密集生成用インデックス構築完了');
}

function buildSolverIndex() {
    for (const key in wordsByLengthSolver) {
        solverIndex[key] = {};

        for (const len in wordsByLengthSolver[key]) {
            const words = wordsByLengthSolver[key][len];
            const L = Number(len);
            const nW = (words.length + 31) >>> 5;
            const byPosChar = Array.from({ length: L }, () => new Map());
            const full = new Uint32Array(nW);

            words.forEach((w, idx) => {
                full[idx >>> 5] |= (1 << (idx & 31));

                for (let p = 0; p < L; p++) {
                    let bs = byPosChar[p].get(w[p]);

                    if (!bs) {
                        bs = new Uint32Array(nW);
                        byPosChar[p].set(w[p], bs);
                    }

                    bs[idx >>> 5] |= (1 << (idx & 31));
                }
            });

            solverIndex[key][len] = { words, nW, byPosChar, full };
        }
    }

    console.log('- ソルバー用ビットセットインデックス構築完了');
}

loadAndOptimizeWordLists();
buildDenseWordIndex();
buildSolverIndex();

// =========================================================
// 盤面ユーティリティ
// =========================================================

function createEmptyGrid(rows, cols) {
    return Array.from({ length: rows }, () => Array(cols).fill(' '));
}

function displayListName(listUsedName) {
    return listUsedName === 'countries_capitals'
        ? '国名・首都名'
        : listUsedName;
}

function gridToDisplay(grid) {
    return grid.map(row =>
        row.map(cell => cell === ' ' ? '⬛︎' : cell)
    );
}

// =========================================================
// 2. 通常ジェネレーター
// =========================================================

function placeWord(grid, word, r, c, direction, isFirstWord) {
    const rows = grid.length;
    const cols = grid[0].length;
    const length = word.length;

    const newGrid = grid.map(row => [...row]);

    let intersectionCount = 0;

    for (let i = 0; i < length; i++) {
        const currentR = r + (direction === 'vertical' ? i : 0);
        const currentC = c + (direction === 'horizontal' ? i : 0);

        if (
            currentR < 0 ||
            currentR >= rows ||
            currentC < 0 ||
            currentC >= cols
        ) {
            return null;
        }

        const existingChar = newGrid[currentR][currentC];

        if (existingChar !== ' ' && existingChar !== word[i]) {
            return null;
        }

        if (existingChar === word[i]) {
            intersectionCount++;
        }

        if (existingChar === ' ') {
            if (direction === 'horizontal') {
                if (
                    (currentR > 0 && newGrid[currentR - 1][currentC] !== ' ') ||
                    (currentR < rows - 1 && newGrid[currentR + 1][currentC] !== ' ')
                ) {
                    return null;
                }
            } else {
                if (
                    (currentC > 0 && newGrid[currentR][currentC - 1] !== ' ') ||
                    (currentC < cols - 1 && newGrid[currentR][currentC + 1] !== ' ')
                ) {
                    return null;
                }
            }
        }

        newGrid[currentR][currentC] = word[i];
    }

    const endR = r + (direction === 'vertical' ? length : 0);
    const endC = c + (direction === 'horizontal' ? length : 0);
    const startR = r - (direction === 'vertical' ? 1 : 0);
    const startC = c - (direction === 'horizontal' ? 1 : 0);

    if (
        startR >= 0 &&
        startR < rows &&
        startC >= 0 &&
        startC < cols &&
        newGrid[startR][startC] !== ' '
    ) {
        return null;
    }

    if (
        endR >= 0 &&
        endR < rows &&
        endC >= 0 &&
        endC < cols &&
        newGrid[endR][endC] !== ' '
    ) {
        return null;
    }

    if (intersectionCount === 0 && !isFirstWord) {
        return null;
    }

    return newGrid;
}

function countIsolatedEmptyBlocks(grid) {
    const rows = grid.length;
    const cols = grid[0].length;

    const visited = Array.from({ length: rows }, () => Array(cols).fill(false));

    let isolatedBlockCount = 0;
    const isolatedCells = new Set();

    const directions = [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [-1, 1], [1, -1], [1, 1]
    ];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (grid[r][c] === ' ' && !visited[r][c]) {
                let isTouchingBoundary = false;
                const queue = [[r, c]];
                const currentBlock = new Set();

                visited[r][c] = true;
                currentBlock.add(`${r},${c}`);

                if (
                    r === 0 ||
                    r === rows - 1 ||
                    c === 0 ||
                    c === cols - 1
                ) {
                    isTouchingBoundary = true;
                }

                let head = 0;

                while (head < queue.length) {
                    const [currR, currC] = queue[head++];

                    for (const [dr, dc] of directions) {
                        const nextR = currR + dr;
                        const nextC = currC + dc;

                        if (
                            nextR >= 0 &&
                            nextR < rows &&
                            nextC >= 0 &&
                            nextC < cols
                        ) {
                            if (
                                grid[nextR][nextC] === ' ' &&
                                !visited[nextR][nextC]
                            ) {
                                visited[nextR][nextC] = true;
                                queue.push([nextR, nextC]);
                                currentBlock.add(`${nextR},${nextC}`);

                                if (
                                    nextR === 0 ||
                                    nextR === rows - 1 ||
                                    nextC === 0 ||
                                    nextC === cols - 1
                                ) {
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

    return {
        count: isolatedBlockCount,
        isolatedCells
    };
}

function getUntouchedWords(placedWords, isolatedCells) {
    if (isolatedCells.size === 0) {
        return placedWords;
    }

    const untouchedWords = [];

    const adjacencies = [
        [-1, 0], [1, 0], [0, -1], [0, 1]
    ];

    for (const pWord of placedWords) {
        let isTouching = false;

        for (let i = 0; i < pWord.word.length; i++) {
            const r = pWord.r + (pWord.direction === 'vertical' ? i : 0);
            const c = pWord.c + (pWord.direction === 'horizontal' ? i : 0);

            for (const [dr, dc] of adjacencies) {
                if (isolatedCells.has(`${r + dr},${c + dc}`)) {
                    isTouching = true;
                    break;
                }
            }

            if (isTouching) break;
        }

        if (!isTouching) {
            untouchedWords.push(pWord);
        }
    }

    return untouchedWords;
}

function calculateDensityScore(grid, placedWords) {
    let emptyCells = 0;

    for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[0].length; c++) {
            if (grid[r][c] === ' ') {
                emptyCells++;
            }
        }
    }

    const { count: isolatedBlocks, isolatedCells } = countIsolatedEmptyBlocks(grid);

    const untouchedWords = getUntouchedWords(placedWords, isolatedCells);
    const touchedWordsCount = placedWords.length - untouchedWords.length;

    const baseScore = placedWords.length * 10000 - emptyCells;
    const topologyBonus = isolatedBlocks * 10000000000;

    const noIsolatedBlockPenalty = isolatedBlocks === 0 ? -5000000000 : 0;
    const untouchedWordPenalty = untouchedWords.length * -300000000;

    let contactBonus = 0;

    if (placedWords.length > 0) {
        contactBonus = (touchedWordsCount / placedWords.length) * 100000;

        if (isolatedBlocks > 0 && untouchedWords.length === 0) {
            contactBonus += 1000000;
        }
    }

    return (
        topologyBonus +
        noIsolatedBlockPenalty +
        untouchedWordPenalty +
        baseScore +
        contactBonus
    );
}

function generateCrossword(rows, cols, indexedWords, initialPlacedWords = []) {
    const MAX_ATTEMPTS = 150000;

    let attemptCount = 0;

    const availableLengths = Object.keys(indexedWords)
        .map(Number)
        .sort((a, b) => b - a)
        .sort(() => Math.random() - 0.5);

    let bestSolution = {
        grid: createEmptyGrid(rows, cols),
        placedWords: [],
        score: 0,
        densityScore: -Infinity
    };

    let initialGrid = createEmptyGrid(rows, cols);
    const initialUsed = new Set();
    const initialPlaced = [];

    for (const pWord of initialPlacedWords) {
        const placedGrid = placeWord(
            initialGrid,
            pWord.word,
            pWord.r,
            pWord.c,
            pWord.direction,
            true
        );

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
        const centerR = rows / 2;
        const centerC = cols / 2;
        const points = [];

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (grid[r][c] !== ' ') {
                    points.push({
                        r,
                        c,
                        char: grid[r][c],
                        distanceSq:
                            Math.pow(r - centerR, 2) +
                            Math.pow(c - centerC, 2)
                    });
                }
            }
        }

        return points.sort((a, b) => b.distanceSq - a.distanceSq);
    }

    function backtrack(currentGrid, usedWords, placedWords) {
        if (attemptCount++ > MAX_ATTEMPTS) {
            return;
        }

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
                        const placedGrid = placeWord(
                            currentGrid,
                            word,
                            centerR,
                            centerC,
                            dir,
                            true
                        );

                        if (placedGrid) {
                            usedWords.add(word);
                            placedWords.push({
                                word,
                                r: centerR,
                                c: centerC,
                                direction: dir
                            });

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
                                const startR =
                                    direction === 'horizontal'
                                        ? hookR
                                        : hookR - i;

                                const startC =
                                    direction === 'horizontal'
                                        ? hookC - i
                                        : hookC;

                                const newGrid = placeWord(
                                    currentGrid,
                                    word,
                                    startR,
                                    startC,
                                    direction,
                                    false
                                );

                                if (newGrid) {
                                    usedWords.add(word);

                                    placedWords.push({
                                        word,
                                        r: startR,
                                        c: startC,
                                        direction
                                    });

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
                const placedGrid = placeWord(
                    initialGrid,
                    startWord,
                    centerR,
                    centerC,
                    dir,
                    true
                );

                if (placedGrid) {
                    initialUsed.add(startWord);

                    initialPlaced.push({
                        word: startWord,
                        r: centerR,
                        c: centerC,
                        direction: dir
                    });

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
// 2-B. 密集優先ジェネレーター
// =========================================================

function countFilledCells(grid) {
    let count = 0;

    for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[0].length; c++) {
            if (grid[r][c] !== ' ') {
                count++;
            }
        }
    }

    return count;
}

function countDenseBlocksDetailed(grid) {
    const rows = grid.length;
    const cols = grid[0].length;

    const result = {
        block2x2: 0,
        block2x3: 0,
        block3x2: 0,
        block3x3: 0,
        score: 0
    };

    function isFilledRect(r, c, h, w) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (grid[r + y][c + x] === ' ') {
                    return false;
                }
            }
        }

        return true;
    }

    for (let r = 0; r <= rows - 2; r++) {
        for (let c = 0; c <= cols - 2; c++) {
            if (isFilledRect(r, c, 2, 2)) {
                result.block2x2++;
                result.score += 10;
            }
        }
    }

    for (let r = 0; r <= rows - 2; r++) {
        for (let c = 0; c <= cols - 3; c++) {
            if (isFilledRect(r, c, 2, 3)) {
                result.block2x3++;
                result.score += 35;
            }
        }
    }

    for (let r = 0; r <= rows - 3; r++) {
        for (let c = 0; c <= cols - 2; c++) {
            if (isFilledRect(r, c, 3, 2)) {
                result.block3x2++;
                result.score += 35;
            }
        }
    }

    for (let r = 0; r <= rows - 3; r++) {
        for (let c = 0; c <= cols - 3; c++) {
            if (isFilledRect(r, c, 3, 3)) {
                result.block3x3++;
                result.score += 120;
            }
        }
    }

    return result;
}

function calculateDenseModeScore(grid, placedWords) {
    const dense = countDenseBlocksDetailed(grid);
    const filledCells = countFilledCells(grid);
    const emptyCells = grid.length * grid[0].length - filledCells;

    const denseBlockBonus = dense.score * 10000000;
    const filledBonus = filledCells * 100000;
    const wordBonus = placedWords.length * 70000;
    const emptyPenalty = emptyCells * 100;

    return denseBlockBonus + filledBonus + wordBonus - emptyPenalty;
}

function placeWordDenseWithStats(grid, word, r, c, direction, isFirstWord) {
    const rows = grid.length;
    const cols = grid[0].length;
    const length = word.length;

    const newGrid = grid.map(row => [...row]);

    let intersectionCount = 0;
    let newCellCount = 0;

    for (let i = 0; i < length; i++) {
        const currentR = r + (direction === 'vertical' ? i : 0);
        const currentC = c + (direction === 'horizontal' ? i : 0);

        if (
            currentR < 0 ||
            currentR >= rows ||
            currentC < 0 ||
            currentC >= cols
        ) {
            return null;
        }

        const existingChar = newGrid[currentR][currentC];

        if (existingChar !== ' ' && existingChar !== word[i]) {
            return null;
        }

        if (existingChar === word[i]) {
            intersectionCount++;
        }

        if (existingChar === ' ') {
            newCellCount++;
        }

        newGrid[currentR][currentC] = word[i];
    }

    const beforeR = r - (direction === 'vertical' ? 1 : 0);
    const beforeC = c - (direction === 'horizontal' ? 1 : 0);
    const afterR = r + (direction === 'vertical' ? length : 0);
    const afterC = c + (direction === 'horizontal' ? length : 0);

    if (
        beforeR >= 0 &&
        beforeR < rows &&
        beforeC >= 0 &&
        beforeC < cols &&
        newGrid[beforeR][beforeC] !== ' '
    ) {
        return null;
    }

    if (
        afterR >= 0 &&
        afterR < rows &&
        afterC >= 0 &&
        afterC < cols &&
        newGrid[afterR][afterC] !== ' '
    ) {
        return null;
    }

    if (!isFirstWord && intersectionCount === 0) {
        return null;
    }

    if (newCellCount === 0) {
        return null;
    }

    return {
        grid: newGrid,
        intersectionCount,
        newCellCount
    };
}

function generateDenseCrossword(rows, cols, indexedWords, wordIndex) {
    const MAX_ATTEMPTS = 80000;
    const BEAM_WIDTH = 8;
    const MAX_INITIAL_CANDIDATES_PER_LENGTH = 80;
    const MAX_INDEXED_CANDIDATES_PER_HOOK = 120;

    let attemptCount = 0;

    const availableLengths = Object.keys(indexedWords)
        .map(Number)
        .filter(length => length <= Math.max(rows, cols))
        .sort((a, b) => b - a);

    let bestSolution = {
        grid: createEmptyGrid(rows, cols),
        placedWords: [],
        score: 0,
        densityScore: -Infinity,
        denseInfo: null
    };

    const currentCandidates = {};

    for (const length in indexedWords) {
        currentCandidates[length] = shuffleArray([...indexedWords[length]]);
    }

    function findHookPoints(grid) {
        const points = [];
        const centerR = rows / 2;
        const centerC = cols / 2;

        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (grid[r][c] !== ' ') {
                    const distanceSq =
                        Math.pow(r - centerR, 2) +
                        Math.pow(c - centerC, 2);

                    points.push({
                        r,
                        c,
                        char: grid[r][c],
                        distanceSq
                    });
                }
            }
        }

        return points.sort((a, b) => a.distanceSq - b.distanceSq);
    }

    function updateBest(currentGrid, placedWords) {
        const denseInfo = countDenseBlocksDetailed(currentGrid);
        const currentScore = calculateDenseModeScore(currentGrid, placedWords);

        if (currentScore > bestSolution.densityScore) {
            bestSolution = {
                grid: currentGrid.map(row => [...row]),
                placedWords: [...placedWords],
                score: placedWords.length,
                densityScore: currentScore,
                denseInfo
            };
        }
    }

    function evaluatePlacement(beforeGrid, afterGrid, stats, placedWordsAfter) {
        const beforeDense = countDenseBlocksDetailed(beforeGrid);
        const afterDense = countDenseBlocksDetailed(afterGrid);

        const denseGain = afterDense.score - beforeDense.score;

        const block2x2Gain = afterDense.block2x2 - beforeDense.block2x2;
        const block2x3Gain = afterDense.block2x3 - beforeDense.block2x3;
        const block3x2Gain = afterDense.block3x2 - beforeDense.block3x2;
        const block3x3Gain = afterDense.block3x3 - beforeDense.block3x3;

        const localScore =
            block3x3Gain * 100000000 +
            block2x3Gain * 20000000 +
            block3x2Gain * 20000000 +
            block2x2Gain * 5000000 +
            denseGain * 100000 +
            stats.intersectionCount * 300000 +
            stats.newCellCount * 50000 +
            placedWordsAfter.length * 1000;

        return localScore;
    }

    function getInitialPlacements(currentGrid, usedWords, placedWords) {
        const placements = [];

        for (const length of availableLengths) {
            const candidates = currentCandidates[length];

            if (!candidates) continue;

            const limitedCandidates = candidates.slice(0, MAX_INITIAL_CANDIDATES_PER_LENGTH);

            for (const word of limitedCandidates) {
                if (usedWords.has(word)) continue;

                const directions = ['horizontal', 'vertical'];

                for (const direction of directions) {
                    const startR =
                        direction === 'horizontal'
                            ? Math.floor(rows / 2)
                            : Math.floor(rows / 2 - word.length / 2);

                    const startC =
                        direction === 'horizontal'
                            ? Math.floor(cols / 2 - word.length / 2)
                            : Math.floor(cols / 2);

                    const placed = placeWordDenseWithStats(
                        currentGrid,
                        word,
                        startR,
                        startC,
                        direction,
                        true
                    );

                    if (!placed) continue;

                    const nextPlacedWords = [
                        ...placedWords,
                        {
                            word,
                            r: startR,
                            c: startC,
                            direction
                        }
                    ];

                    const score = evaluatePlacement(
                        currentGrid,
                        placed.grid,
                        placed,
                        nextPlacedWords
                    );

                    placements.push({
                        word,
                        grid: placed.grid,
                        r: startR,
                        c: startC,
                        direction,
                        score
                    });
                }
            }
        }

        return placements
            .sort((a, b) => b.score - a.score)
            .slice(0, BEAM_WIDTH);
    }

    function getNextPlacements(currentGrid, usedWords, placedWords) {
        const placements = [];
        const hookPoints = findHookPoints(currentGrid);

        for (const hookPoint of hookPoints) {
            const indexedCandidates = wordIndex[hookPoint.char] || [];
            const limitedIndexedCandidates = indexedCandidates.slice(0, MAX_INDEXED_CANDIDATES_PER_HOOK);

            for (const item of limitedIndexedCandidates) {
                const word = item.word;
                const i = item.pos;

                if (usedWords.has(word)) continue;

                const directions = ['horizontal', 'vertical'];

                for (const direction of directions) {
                    const startR =
                        direction === 'horizontal'
                            ? hookPoint.r
                            : hookPoint.r - i;

                    const startC =
                        direction === 'horizontal'
                            ? hookPoint.c - i
                            : hookPoint.c;

                    const placed = placeWordDenseWithStats(
                        currentGrid,
                        word,
                        startR,
                        startC,
                        direction,
                        false
                    );

                    if (!placed) continue;

                    const nextPlacedWords = [
                        ...placedWords,
                        {
                            word,
                            r: startR,
                            c: startC,
                            direction
                        }
                    ];

                    const score = evaluatePlacement(
                        currentGrid,
                        placed.grid,
                        placed,
                        nextPlacedWords
                    );

                    placements.push({
                        word,
                        grid: placed.grid,
                        r: startR,
                        c: startC,
                        direction,
                        score
                    });
                }
            }
        }

        return placements
            .sort((a, b) => b.score - a.score)
            .slice(0, BEAM_WIDTH);
    }

    function backtrack(currentGrid, usedWords, placedWords) {
        if (attemptCount++ > MAX_ATTEMPTS) {
            return;
        }

        updateBest(currentGrid, placedWords);

        let placements;

        if (placedWords.length === 0) {
            placements = getInitialPlacements(
                currentGrid,
                usedWords,
                placedWords
            );
        } else {
            placements = getNextPlacements(
                currentGrid,
                usedWords,
                placedWords
            );
        }

        if (placements.length === 0) {
            return;
        }

        for (const placement of placements) {
            usedWords.add(placement.word);

            placedWords.push({
                word: placement.word,
                r: placement.r,
                c: placement.c,
                direction: placement.direction
            });

            backtrack(
                placement.grid,
                usedWords,
                placedWords
            );

            placedWords.pop();
            usedWords.delete(placement.word);
        }
    }

    const initialGrid = createEmptyGrid(rows, cols);
    const usedWords = new Set();
    const placedWords = [];

    backtrack(initialGrid, usedWords, placedWords);

    return bestSolution;
}

// =========================================================
// 3. ソルバー(ビットセット + 前向き検査 + MRV)
// =========================================================

function getWordSlots(pattern) {
    const rows = pattern.length;
    const cols = pattern[0].length;

    const wordSlots = [];

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (pattern[r][c] === 1) {
                if (
                    (c === 0 || pattern[r][c - 1] === 0) &&
                    c < cols - 1 &&
                    pattern[r][c + 1] === 1
                ) {
                    let length = 0;

                    for (let i = c; i < cols; i++) {
                        if (pattern[r][i] === 1) {
                            length++;
                        } else {
                            break;
                        }
                    }

                    wordSlots.push({
                        index: wordSlots.length,
                        position: { r, c },
                        direction: 'horizontal',
                        length,
                        intersections: []
                    });
                }

                if (
                    (r === 0 || pattern[r - 1][c] === 0) &&
                    r < rows - 1 &&
                    pattern[r + 1][c] === 1
                ) {
                    let length = 0;

                    for (let i = r; i < rows; i++) {
                        if (pattern[i][c] === 1) {
                            length++;
                        } else {
                            break;
                        }
                    }

                    wordSlots.push({
                        index: wordSlots.length,
                        position: { r, c },
                        direction: 'vertical',
                        length,
                        intersections: []
                    });
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

                const crossR = horiz.position.r;
                const crossC = vert.position.c;

                if (
                    crossR >= vertStartR &&
                    crossR <= vertEndR &&
                    crossC >= horizStartC &&
                    crossC <= horizEndC
                ) {
                    const posA =
                        slotA.direction === 'horizontal'
                            ? crossC - horizStartC
                            : crossR - vertStartR;

                    const posB =
                        slotB.direction === 'horizontal'
                            ? crossC - horizStartC
                            : crossR - vertStartR;

                    slotA.intersections.push({
                        otherSlotIndex: slotB.index,
                        thisPos: posA,
                        otherPos: posB
                    });

                    slotB.intersections.push({
                        otherSlotIndex: slotA.index,
                        thisPos: posB,
                        otherPos: posA
                    });
                }
            }
        }
    }

    return wordSlots;
}

function popcnt(bs) {
    let c = 0;

    for (let i = 0; i < bs.length; i++) {
        let v = bs[i];
        v = v - ((v >>> 1) & 0x55555555);
        v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
        c += Math.imul((v + (v >>> 4)) & 0x0F0F0F0F, 0x01010101) >>> 24;
    }

    return c;
}

function isEmptyBitset(bs) {
    for (let i = 0; i < bs.length; i++) {
        if (bs[i] !== 0) return false;
    }

    return true;
}

function solveCrossword(pattern, listUsedName, opts = {}) {
    const maxSolutions = opts.maxSolutions ?? 200;
    const timeLimitMs = opts.timeLimitMs ?? 5000;

    const idx = solverIndex[listUsedName];
    const rows = pattern.length;
    const cols = pattern[0].length;
    const slots = getWordSlots(pattern);
    const n = slots.length;

    const solutions = [];
    let truncated = false;

    if (n === 0) return { solutions, truncated };

    const info = slots.map(s => idx[s.length]);

    // 辞書に存在しない長さのスロットがあれば解なし
    if (info.some(x => !x)) return { solutions, truncated };

    // 深さごとに候補集合を保持(再帰中に new しない)
    const domains = Array.from({ length: n + 1 }, () =>
        info.map(inf => new Uint32Array(inf.nW))
    );

    for (let i = 0; i < n; i++) {
        domains[0][i].set(info[i].full);
    }

    const assigned = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    const deadline = Date.now() + timeLimitMs;
    let nodes = 0;

    function recordSolution() {
        const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));

        for (let i = 0; i < n; i++) {
            const s = slots[i];
            const word = info[i].words[assigned[i]];

            for (let k = 0; k < s.length; k++) {
                const r = s.position.r + (s.direction === 'vertical' ? k : 0);
                const c = s.position.c + (s.direction === 'horizontal' ? k : 0);
                grid[r][c] = word[k];
            }
        }

        solutions.push(grid);

        if (solutions.length >= maxSolutions) truncated = true;
    }

    function dfs(depth) {
        if (truncated) return;

        if ((++nodes & 1023) === 0 && Date.now() > deadline) {
            truncated = true;
            return;
        }

        const cur = domains[depth];

        // MRV: 候補が最小のスロットを選ぶ
        let best = -1;
        let bestCnt = Infinity;

        for (let i = 0; i < n; i++) {
            if (done[i]) continue;

            const c = popcnt(cur[i]);

            if (c === 0) return;

            if (c < bestCnt) {
                bestCnt = c;
                best = i;
            }
        }

        if (best === -1) {
            recordSolution();
            return;
        }

        const slot = slots[best];
        const dom = cur[best];
        const inf = info[best];
        const next = domains[depth + 1];

        done[best] = 1;

        for (let b = 0; b < dom.length && !truncated; b++) {
            let v = dom[b];

            while (v !== 0 && !truncated) {
                const low = v & -v;
                const wi = (b << 5) + (31 - Math.clz32(low));
                v ^= low;

                const word = inf.words[wi];

                for (let k = 0; k < n; k++) next[k].set(cur[k]);

                let ok = true;

                // 交差スロットを絞り込む(前向き検査)
                for (const x of slot.intersections) {
                    const o = x.otherSlotIndex;

                    if (done[o]) continue;

                    const m = info[o].byPosChar[x.otherPos].get(word[x.thisPos]);

                    if (!m) { ok = false; break; }

                    const d = next[o];
                    let any = 0;

                    for (let t = 0; t < d.length; t++) {
                        d[t] &= m[t];
                        any |= d[t];
                    }

                    if (any === 0) { ok = false; break; }
                }

                // 同じ単語を重複して使わない
                if (ok) {
                    for (let o = 0; o < n; o++) {
                        if (done[o] || o === best || slots[o].length !== slot.length) continue;

                        const d = next[o];
                        d[wi >>> 5] &= ~(1 << (wi & 31));

                        if (isEmptyBitset(d)) { ok = false; break; }
                    }
                }

                if (!ok) continue;

                assigned[best] = wi;
                dfs(depth + 1);
                assigned[best] = -1;
            }
        }

        done[best] = 0;
    }

    dfs(0);

    return { solutions, truncated };
}

// =========================================================
// 4. API エンドポイント
// =========================================================

// 通常 自動生成API
app.post('/generate', (req, res) => {
    const { rows, cols, listName } = req.body;

    if (
        !rows ||
        !cols ||
        rows < 5 ||
        cols < 5 ||
        rows > 20 ||
        cols > 20
    ) {
        return res.status(400).send({
            error: '縦横のマス目の数は5から20の間で指定してください。'
        });
    }

    const listUsedName =
        Object.hasOwn(indexedWordLists, listName)
            ? listName
            : 'pokemon';

    const currentWordList = indexedWordLists[listUsedName];

    let currentBestResult = {
        grid: createEmptyGrid(rows, cols),
        placedWords: [],
        score: 0,
        densityScore: -Infinity
    };

    const NUM_RESTARTS = 30;
    const MAX_REPLACEMENT_ROUNDS = 5;

    let finalResult = null;

    for (let i = 0; i < NUM_RESTARTS; i++) {
        const result = generateCrossword(rows, cols, currentWordList);

        if (result.densityScore > currentBestResult.densityScore) {
            currentBestResult = result;
        }
    }

    let rounds = 0;

    while (rounds < MAX_REPLACEMENT_ROUNDS) {
        rounds++;

        const { isolatedCells } =
            countIsolatedEmptyBlocks(currentBestResult.grid);

        const untouchedWords =
            getUntouchedWords(currentBestResult.placedWords, isolatedCells);

        if (untouchedWords.length === 0) {
            finalResult = currentBestResult;
            break;
        }

        if (untouchedWords.length === currentBestResult.placedWords.length) {
            break;
        }

        const wordsToKeep = currentBestResult.placedWords.filter(
            pWord => !untouchedWords.includes(pWord)
        );

        let restartResult = {
            densityScore: -Infinity
        };

        for (let i = 0; i < 5; i++) {
            const result = generateCrossword(
                rows,
                cols,
                currentWordList,
                wordsToKeep
            );

            if (result.densityScore > restartResult.densityScore) {
                restartResult = result;
            }
        }

        if (restartResult.densityScore > currentBestResult.densityScore) {
            currentBestResult = restartResult;
        } else {
            break;
        }
    }

    const resultToDisplay = finalResult || currentBestResult;

    const { isolatedCells } = countIsolatedEmptyBlocks(resultToDisplay.grid);
    const finalUntouchedWords =
        getUntouchedWords(resultToDisplay.placedWords, isolatedCells);

    if (isolatedCells.size === 0 || finalUntouchedWords.length > 0) {
        const warning =
            finalUntouchedWords.length > 0
                ? '全ての単語を孤立ブロックに接させることができませんでした。不合格な単語が残っています。'
                : '要件を満たす孤立した空きマス塊のあるパズルが見つかりませんでした。';

        return res.json({
            grid: gridToDisplay(createEmptyGrid(rows, cols)),
            placedWords: [],
            score: 0,
            listUsed: displayListName(listUsedName),
            warning
        });
    }

    res.json({
        grid: gridToDisplay(resultToDisplay.grid),
        placedWords: resultToDisplay.placedWords,
        score: resultToDisplay.score,
        listUsed: displayListName(listUsedName),
        mode: 'normal'
    });
});

// 密集優先 自動生成API
app.post('/generate-dense', (req, res) => {
    const { rows, cols, listName } = req.body;

    if (
        !rows ||
        !cols ||
        rows < 5 ||
        cols < 5 ||
        rows > 20 ||
        cols > 20
    ) {
        return res.status(400).send({
            error: '縦横のマス目の数は5から20の間で指定してください。'
        });
    }

    const listUsedName =
        Object.hasOwn(indexedWordLists, listName)
            ? listName
            : 'pokemon';

    const currentWordList = indexedWordLists[listUsedName];
    const currentWordIndex = denseWordIndex[listUsedName] || {};

    let bestResult = {
        grid: createEmptyGrid(rows, cols),
        placedWords: [],
        score: 0,
        densityScore: -Infinity,
        denseInfo: null
    };

    const NUM_RESTARTS = 16;

    for (let i = 0; i < NUM_RESTARTS; i++) {
        const result = generateDenseCrossword(
            rows,
            cols,
            currentWordList,
            currentWordIndex
        );

        if (result.densityScore > bestResult.densityScore) {
            bestResult = result;
        }
    }

    res.json({
        grid: gridToDisplay(bestResult.grid),
        placedWords: bestResult.placedWords,
        score: bestResult.score,
        densityScore: bestResult.densityScore,
        denseInfo: bestResult.denseInfo || countDenseBlocksDetailed(bestResult.grid),
        listUsed: displayListName(listUsedName),
        mode: 'dense'
    });
});

// パターン解法API
app.post('/solve', (req, res) => {
    const { pattern, listName } = req.body;

    const valid =
        Array.isArray(pattern) &&
        pattern.length >= 2 && pattern.length <= 15 &&
        pattern.every(row =>
            Array.isArray(row) &&
            row.length === pattern[0].length &&
            row.length >= 2 && row.length <= 15 &&
            row.every(v => v === 0 || v === 1)
        );

    if (!valid) {
        return res.status(400).send({ error: '無効なパターンデータです。' });
    }

    const listUsedName =
        Object.hasOwn(solverIndex, listName)
            ? listName
            : 'pokemon';

    const { solutions, truncated } = solveCrossword(pattern, listUsedName, {
        maxSolutions: 200,
        timeLimitMs: 5000
    });

    if (solutions.length === 0) {
        return res.json({
            solutions: [],
            warning: truncated
                ? '制限時間内に解が見つかりませんでした。パターンを簡単にしてみてください。'
                : '解が見つかりませんでした。パターンや辞書を変えてみてください。'
        });
    }

    res.json({
        solutions,
        truncated,
        listUsed: displayListName(listUsedName)
    });
});

app.listen(port, () => {
    console.log('統合サーバーが起動しました 🚀');
    console.log(`ブラウザで http://localhost:${port}/ にアクセスしてください`);
});