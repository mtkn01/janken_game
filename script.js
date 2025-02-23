/**************************************************
 * 1. 定数・変数の準備
 **************************************************/
const CPU_HANDS = ["paper", "rocks", "scissors"];
let cpuHand = CPU_HANDS[Math.floor(Math.random() * 3)];
let loseCount = 0;

// 時間制限(秒)
const PLAY_TIME = 5;
let startTime = null; // ゲーム開始時は startTime をセット

// TensorFlow.jsモデル
let jankenModel = null;

// Mediapipe Hands
let hands = null;
let camera = null;

// DOM要素取得
const videoElement = document.getElementById('video');
const canvasElement = document.getElementById('canvas');
const canvasCtx = canvasElement.getContext('2d', { alpha: true });

const loseCountEl = document.getElementById('loseCount');
const timeLeftEl = document.getElementById('timeLeft');
const gameoverOverlay = document.getElementById('gameover');
const finalScoreEl = document.getElementById('finalScore');
const startButton = document.getElementById('startButton');
const retryButton = document.getElementById('retryButton');
const cpuHandImg = document.getElementById('cpuHandImg');

/**************************************************
 * 1.1 キャンバスの解像度を高めに設定（高画質用）
 **************************************************/
canvasElement.width = 1280;
canvasElement.height = 960;

// じゃんけん画像のプリロードキャッシュ
const preloadedImages = {};
const handImagePaths = {
  "paper": "img/paper.png",
  "rocks": "img/rocks.png",
  "scissors": "img/scissors.png"
};

function preloadImages() {
  for (const key in handImagePaths) {
    const img = new Image();
    img.src = handImagePaths[key];
    preloadedImages[key] = img;
  }
}
preloadImages();

/**************************************************
 * 2. ユーティリティ関数
 **************************************************/
// 連続で同じ手が出ないようにしている（後々改善の余地あり）
function getRandomCPUHand() {
  let newHand;
  do {
    newHand = CPU_HANDS[Math.floor(Math.random() * CPU_HANDS.length)];
  } while(newHand === cpuHand);
  return newHand;
}

function didUserLose(userHand, cpuHand) {
  if (userHand === "rocks"    && cpuHand === "paper")    return true;
  if (userHand === "scissors" && cpuHand === "rocks")    return true;
  if (userHand === "paper"    && cpuHand === "scissors") return true;
  return false;
}

/**************************************************
 * 3. ゲーム終了処理
 **************************************************/
function endGame() {
  if (camera) camera.stop();
  finalScoreEl.textContent = loseCount;
  gameoverOverlay.style.display = 'flex';
}

/**************************************************
 * 4. ゲーム開始処理（共通）
 **************************************************/
function startGame() {
  // 初期化
  loseCount = 0;
  loseCountEl.textContent = 0;
  startTime = Date.now();
  cpuHand = getRandomCPUHand();
  gameoverOverlay.style.display = 'none';
  // カメラ開始
  camera.start();
}

/**************************************************
 * 5. タイムリミットチェック
 **************************************************/
function checkTimeLimit() {
  if (startTime === null) {
    timeLeftEl.textContent = PLAY_TIME;
    return;
  }
  let elapsed = (Date.now() - startTime) / 1000;
  let remain = Math.floor(PLAY_TIME - elapsed);
  if (remain < 0) {
    remain = 0;
    endGame();
  }
  timeLeftEl.textContent = remain;
}

setInterval(checkTimeLimit, 1000);

/**************************************************
 * 6. TensorFlow.jsモデルの読み込み
 **************************************************/
tf.loadLayersModel('./web_model/model.json').then(model => {
  jankenModel = model;
  console.log('Janken Model Loaded!');
}).catch(err => {
  console.error('Failed to load TF.js model:', err);
});

/**************************************************
 * 7. Mediapipe Hands のセットアップ
 **************************************************/
hands = new Hands({
  locateFile: (file) => {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
  }
});
hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});
hands.onResults(onResults);

// カメラ初期化（開始はGame Start時）
camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 640,
  height: 480
});

/**************************************************
 * 8. カウントダウンオーバーレイ表示＆イベントリスナー
 **************************************************/
function showCountdownOverlay(seconds) {
  const countdownOverlay = document.getElementById('countdownOverlay');
  
  // 初期化開始：カメラを起動してMediapipe等のウォームアップを実施
  camera.start();
  
  // カウントダウン中はCPU handエリアとランドマーク表示エリアを非表示に
  document.getElementById('cpu-hand-area').style.display = 'none';
  document.getElementById('landmark-area').style.display = 'none';
  
  countdownOverlay.style.display = 'flex';
  let count = seconds;
  countdownOverlay.textContent = count;
  
  const intervalId = setInterval(() => {
    count--;
    if (count > 0) {
      countdownOverlay.textContent = count;
    } else {
      clearInterval(intervalId);
      countdownOverlay.style.display = 'none';
      // カウントダウン終了後に表示する
      document.getElementById('cpu-hand-area').style.display = 'block';
      document.getElementById('landmark-area').style.display = 'block';
      startGame();
    }
  }, 1000);
}

if(startButton) {
  startButton.addEventListener('click', () => {
    startButton.disabled = true;
    showCountdownOverlay(3);
  });
}

if(retryButton) {
  retryButton.addEventListener('click', () => {
    gameoverOverlay.style.display = 'none';
    startTime = null;  // endGame()が呼び出されてしまうことを防ぐ（Game Overオーバーレイを非表示のままにする）
    showCountdownOverlay(3);
  });
}

/**************************************************
 * 9. onResults：左右反転＋高画質描画＆手未検出時オーバーレイ表示
 **************************************************/
function onResults(results) {
  // Canvasクリア（透過）
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  // 保存→左右反転して高画質で描画
  canvasCtx.save();
  canvasCtx.translate(canvasElement.width, 0);
  canvasCtx.scale(-1, 1);

  let userHandShape = "other";

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    // 手が検出されたらオーバーレイを非表示
    document.getElementById('no-hand-msg').style.visibility = 'hidden';

    const landmarks = results.multiHandLandmarks[0];
    drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, { color: '#1a73e8', lineWidth: 4 });
    drawLandmarks(canvasCtx, landmarks, { color: '#333', lineWidth: 2 });

    const landmarkArray = [];
    for (let i = 0; i < landmarks.length; i++) {
      landmarkArray.push(landmarks[i].x, landmarks[i].y, landmarks[i].z);
    }

    if (jankenModel) {
      const inputTensor = tf.tensor2d(landmarkArray, [1, 63]);
      const prediction = jankenModel.predict(inputTensor);
      const predictedClass = prediction.argMax(-1).dataSync()[0];
      const maxProb = prediction.max(-1).dataSync()[0];
      inputTensor.dispose();
      prediction.dispose();

      const threshold = 0.94;
      
      if (maxProb < threshold) {
        userHandShape = 'other';
      } else {
        if (predictedClass === 0) userHandShape = 'paper';
        if (predictedClass === 1) userHandShape = 'rocks';
        if (predictedClass === 2) userHandShape = 'scissors';
      }
    }
  } else {
    // 手が検出されなかった場合、オーバーレイを表示
    document.getElementById('no-hand-msg').style.visibility = 'visible';
  }

  canvasCtx.restore();

  // CPU Handの画像更新（既に表示中の画像と異なる場合のみ更新）
  if (cpuHandImg.dataset.current !== cpuHand) {
    cpuHandImg.src = preloadedImages[cpuHand].src;
    cpuHandImg.dataset.current = cpuHand;
  }

  // 負け判定＆スコア更新
  if (["paper", "rocks", "scissors"].includes(userHandShape)) {
    if (didUserLose(userHandShape, cpuHand)) {
      loseCount++;
      loseCountEl.textContent = loseCount;
      cpuHand = getRandomCPUHand();
    }
  }
}
