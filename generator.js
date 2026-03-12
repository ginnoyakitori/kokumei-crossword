// generator.js (不合格単語の除去と再配置版)

const express = require('express');

const fs = require('fs');

const path = require('path');

const app = express();

// 修正前: const port = 3000;
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



        if (currentR < 0 || currentR >= rows || currentC < 0 || currentC >= cols) {

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

                if ((currentR > 0 && newGrid[currentR - 1][currentC] !== ' ') || 

                    (currentR < rows - 1 && newGrid[currentR + 1][currentC] !== ' ')) {

                     return null;

                }

            } else { 

                if ((currentC > 0 && newGrid[currentR][currentC - 1] !== ' ') || 

                    (currentC < cols - 1 && newGrid[currentR][currentC + 1] !== ' ')) {

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



    if (startR >= 0 && startR < rows && startC >= 0 && startC < cols && newGrid[startR][startC] !== ' ') return null;

    if (endR >= 0 && endR < rows && endC >= 0 && endC < cols && newGrid[endR][endC] !== ' ') return null;



    if (intersectionCount === 0 && !isFirstWord) {

        return null; 

    }

    

    return newGrid;

}



/**

 * 壁と接触していない空きマス（黒マス）の塊の数を数え、同時にその座標を返す (8方向接続)

 * @returns { object } { count: number, isolatedCells: Set<string> }

 */

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

                visited[r][c] = true;

                const currentBlock = new Set();

                

                if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {

                    isTouchingBoundary = true;

                }

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



/**

 * 【修正】孤立ブロックに辺で接していない単語（不合格単語）のリストを返す

 * @returns { Array<object> } 接触していない単語オブジェクトのリスト

 */

function getUntouchedWords(placedWords, isolatedCells) {

    const untouchedWords = [];

    

    // 孤立ブロックがない場合、全ての単語が不合格

    if (isolatedCells.size === 0) {

        return placedWords;

    }

    

    // 辺（上下左右）の移動ベクトル

    const adjacencies = [

        [-1, 0], [1, 0], [0, -1], [0, 1]

    ];

    

    for (const pWord of placedWords) {

        let isTouching = false;

        

        for (let i = 0; i < pWord.word.length; i++) {

            let r = pWord.r + (pWord.direction === 'vertical' ? i : 0);

            let c = pWord.c + (pWord.direction === 'horizontal' ? i : 0);

            

            for (const [dr, dc] of adjacencies) {

                const adjR = r + dr;

                const adjC = c + dc;

                const coord = `${adjR},${adjC}`;

                

                if (isolatedCells.has(coord)) {

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





/**

 * グリッドの総合評価スコアを計算する (孤立ブロック超優先 + 接触単語割合ボーナス)

 */

function calculateDensityScore(grid, placedWords) {

    let emptyCells = 0;

    

    const { count: isolatedBlocks, isolatedCells } = countIsolatedEmptyBlocks(grid);

    

    // 1. 空白マス数の計算

    for (let r = 0; r < grid.length; r++) {

        for (let c = 0; c < grid[0].length; c++) {

            if (grid[r][c] === ' ') {

                emptyCells++;

            }

        }

    }

    

    // 2. 単語数と空白マス数に基づく基本スコア

    const baseScore = placedWords.length * 10000 - emptyCells; 

    

    // 3. トポロジーボーナス (孤立ブロックの数を超優先)

    const topologyBonus = isolatedBlocks * 10000000000; 



    // 4. 【新規】接触単語割合ボーナス (全ての単語が孤立ブロックに接する解を緩やかに誘導)

    const untouchedWords = getUntouchedWords(placedWords, isolatedCells);

    const touchedWordsCount = placedWords.length - untouchedWords.length;

    let contactBonus = 0;



    if (placedWords.length > 0) {

         // 単語の接触割合 * 100000 (単語の数と空白マスのペナルティよりも高く設定)

        contactBonus = (touchedWordsCount / placedWords.length) * 100000;

        

        // 全ての単語が接触していたら、さらに大きなボーナスを付与

        if (untouchedWords.length === 0) {

            contactBonus += 50000; 

        }

    }

    

    return topologyBonus + baseScore + contactBonus; 

}





/**

 * メインのクロスワード生成関数

 * (最初の単語の配置から開始し、可能な限り多くの単語を配置しようとする)

 */

function generateCrossword(rows, cols, indexedWords, initialPlacedWords = []) {

    const MAX_ATTEMPTS = 1500000; 

    let attemptCount = 0;

    

    const availableLengths = Object.keys(indexedWords).map(Number).sort((a, b) => b - a).sort(() => Math.random() - 0.5); 



    let bestSolution = { grid: createEmptyGrid(rows, cols), placedWords: [], score: 0, densityScore: -Infinity };

    

    let initialGrid = createEmptyGrid(rows, cols);

    let initialUsed = new Set();

    let initialPlaced = [];



    // 初期配置単語に基づいてグリッドと使用済みリストを構築

    for (const pWord of initialPlacedWords) {

        const placedGrid = placeWord(initialGrid, pWord.word, pWord.r, pWord.c, pWord.direction, true);

        if (placedGrid) {

            initialGrid = placedGrid;

            initialUsed.add(pWord.word);

            initialPlaced.push(pWord);

        } else {

            // ここでエラーになるのは、初期配置が矛盾している場合のみ。通常はありえない。

            console.error("初期単語の再配置中に矛盾が発生しました。");

            return bestSolution;

        }

    }

    

    const currentCandidates = {};

    for (const length in indexedWords) {

        currentCandidates[length] = shuffleArray([...indexedWords[length]]);

    }



    function findHookPoints(grid) {

        const rows = grid.length;

        const cols = grid[0].length;

        const centerR = rows / 2;

        const centerC = cols / 2;

        const points = [];

        

        for (let r = 0; r < rows; r++) {

            for (let c = 0; c < cols; c++) {

                if (grid[r][c] !== ' ') {

                    const distanceSq = Math.pow(r - centerR, 2) + Math.pow(c - centerC, 2);

                    points.push({ r, c, char: grid[r][c], distanceSq });

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

        const sortedLengths = availableLengths;

        const isCurrentlyEmpty = placedWords.length === 0;



        // ... (単語配置ロジックは変更なし) ...

        for (const length of sortedLengths) {

            const candidates = currentCandidates[length]; 

            if (!candidates) continue;



            for (const word of candidates) {

                if (usedWords.has(word)) continue;



                // 最初の単語をランダムに配置する処理は、initialPlacedWordsがある場合はスキップ

                if (isCurrentlyEmpty) {

                    // initialPlacedWordsがある場合は、このブロックは実行されない

                    // なぜなら、initialPlacedWordsが存在すればisCurrentlyEmptyはfalseになるため

                    

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

                                

                                let startR, startC;

                                if (direction === 'horizontal') {

                                    startR = hookR;

                                    startC = hookC - i; 

                                } else {

                                    startR = hookR - i;

                                    startC = hookC;

                                }



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

    

    // 初期単語がない場合のみ、最初の単語をランダムに配置して探索を開始

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

        // 初期単語がある場合、そこからバックトラックを開始

        backtrack(initialGrid, initialUsed, initialPlaced);

    }





    return bestSolution;

}


// =========================================================
// 2. サーバーの設定 (重複排除版)
// =========================================================

const filesMap = {
    'pokemon': ['pokemon.txt'],
    'countries': ['countries.txt'],
    'capitals': ['capitals.txt'],
    'countries_capitals': ['countries.txt', 'capitals.txt']
};

let indexedWordLists = {}; 

function loadAndIndexWords() {
    console.log("単語リストを読み込み、重複を排除してインデックス化中...");
    
    for (const key in filesMap) {
        const fileList = filesMap[key];
        // Setを使用して、このリスト内での重複を自動的に排除する
        const uniqueWords = new Set();

        for (const file of fileList) {
            const filePath = path.join(__dirname, file); 
            
            try {
                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf8')
                                    .split('\n')
                                    .map(s => s.trim())
                                    .filter(s => s.length > 0);
                    
                    // 読み込んだ各単語をSetに追加
                    content.forEach(word => uniqueWords.add(word));
                } else {
                    console.warn(`- 警告: ファイルが見つかりません: ${file}`);
                }
            } catch (error) {
                console.error(`- エラー: ${file} の読み込みに失敗しました。`, error.message);
            }
        }

        if (uniqueWords.size > 0) {
            // Setを配列に変換してからインデックス化関数に渡す
            indexedWordLists[key] = indexWords(Array.from(uniqueWords));
            console.log(`- リスト [${key}]: ${uniqueWords.size} 語を登録（重複排除済み）`);
        }
    }
}

loadAndIndexWords(); 



app.use(express.json());

app.use(express.static(__dirname));



// クロスワード生成APIエンドポイント

app.post('/generate', (req, res) => {

    const { rows, cols, listName } = req.body; 



    // ... (入力チェックは変更なし) ...

    if (!rows || !cols || rows < 5 || cols < 5 || rows > 20 || cols > 20) {

        return res.status(400).send({ error: '縦横のマス目の数は5から20の間で指定してください。' });

    }



    const listUsedName = listName in indexedWordLists ? listName : 'pokemon';

    const currentWordList = indexedWordLists[listUsedName];

    

    if (!currentWordList || Object.keys(currentWordList).length === 0) {

        return res.status(500).json({ error: `単語リスト (${listUsedName}) が空か、ファイルが見つかりません。` });

    }



    console.log(`使用する単語リスト: ${listUsedName}`);

    console.time('Generation Time');

    

    let currentBestResult = { grid: createEmptyGrid(rows, cols), placedWords: [], score: 0, densityScore: -Infinity };

    const NUM_RESTARTS = 30;

    const MAX_REPLACEMENT_ROUNDS = 5;

    let finalResult = null;

    let currentPlacedWords = []; // 保持する単語リスト



    // ステップ1: 最初の単語配置フェーズ (孤立ブロックの核を作る)

    for (let i = 0; i < NUM_RESTARTS; i++) {

        const result = generateCrossword(rows, cols, currentWordList);

        if (result.densityScore > currentBestResult.densityScore) {

            currentBestResult = result;

        }

    }

    currentPlacedWords = currentBestResult.placedWords;

    let rounds = 0;



    // ステップ2: 不合格単語の除去と再配置フェーズ

    while (rounds < MAX_REPLACEMENT_ROUNDS) {

        rounds++;

        

        const { isolatedCells } = countIsolatedEmptyBlocks(currentBestResult.grid);

        const untouchedWords = getUntouchedWords(currentBestResult.placedWords, isolatedCells);



        if (untouchedWords.length === 0) {

            // 要件達成: 全ての単語が接触している

            finalResult = currentBestResult;

            break;

        }



        if (untouchedWords.length === currentBestResult.placedWords.length) {

            // 全ての単語が不合格（孤立ブロック自体がない場合を含む）

            if (rounds === 1) {

                 // 最初の試行で完全に失敗した場合は、再配置を試みる価値がないと判断し、次の初期配置を待つ。

                 // ここでは、外側のループのNUM_RESTARTSに任せるため、 break ではなく continue loop (擬似) とする。

                 break; 

            }

            // 保持できる単語がないため終了

            break;

        }



        console.log(`- ラウンド ${rounds}: 不合格単語 ${untouchedWords.length} 語。再配置を試行します...`);



        // 不合格単語を除外した「核」となる単語リストを作成

        const wordsToKeep = currentBestResult.placedWords.filter(pWord => !untouchedWords.includes(pWord));

        

        // 残りの単語と、未使用の単語リスト全体を使って、再探索

        let restartResult = { densityScore: -Infinity };

        for (let i = 0; i < 5; i++) { // 再配置探索は5回試行

            const result = generateCrossword(rows, cols, currentWordList, wordsToKeep);

            if (result.densityScore > restartResult.densityScore) {

                restartResult = result;

            }

        }

        

        // 再配置後の解が、元の解よりも良かった場合（孤立ブロック数が多い、または接触割合が高い）

        if (restartResult.densityScore > currentBestResult.densityScore) {

            currentBestResult = restartResult;

        } else {

            // スコアが改善しない場合、この道筋では改善できないと判断し終了

            break;

        }

    }



    if (console.timeEnd) {

        console.timeEnd('Generation Time');

    }



    // 最終チェック

    const resultToDisplay = finalResult || currentBestResult;

    const { isolatedCells } = countIsolatedEmptyBlocks(resultToDisplay.grid);

    const finalUntouchedWords = getUntouchedWords(resultToDisplay.placedWords, isolatedCells);



    // 必須条件: 孤立ブロックが1つ以上存在すること AND 孤立ブロックに接していない単語がないこと

    if (isolatedCells.size === 0 || finalUntouchedWords.length > 0) {

        const warning = finalUntouchedWords.length > 0

            ? "全ての単語を孤立ブロックに接させることができませんでした。不合格な単語が残っています。"

            : "要件を満たす孤立した空きマス塊のあるパズルが見つかりませんでした。";

            

        console.log(`警告: ${warning}`);



        // 要件を満たさない場合は、空のグリッドを返す（前回の仕様を維持）

        return res.json({

            grid: createEmptyGrid(rows, cols).map(row => row.map(cell => cell === ' ' ? '⬛︎' : cell)),

            placedWords: [],

            score: 0,

            listUsed: listUsedName,

            warning: warning

        });

    }

    

    // 成功

    const finalGrid = resultToDisplay.grid.map(row => row.map(cell => cell === ' ' ? '⬛︎' : cell));



    res.json({

        grid: finalGrid,

        placedWords: resultToDisplay.placedWords,

        score: resultToDisplay.score,

        listUsed: listUsedName

    });

});



// サーバー起動

app.listen(port, () => {

    console.log(`クロスワードジェネレーターが起動しました 🚀`);

    console.log(`ブラウザで http://localhost:${port}/index.html にアクセスしてください`);

});

