document.addEventListener('DOMContentLoaded', () => {
    // --- 要素 ---
    const targetDisplay = document.getElementById('target-time');
    const currentDisplay = document.getElementById('current-time');
    const startBtn = document.getElementById('start-btn');
    const stopBtn = document.getElementById('stop-btn');
    const nextBtn = document.getElementById('next-btn');
    const resultMessage = document.getElementById('result-message');
    const resultTitle = document.getElementById('result-title');
    const resultDesc = document.getElementById('result-desc');
    
    const machine = document.getElementById('machine');
    const stage = document.getElementById('stage');
    const carModel = document.getElementById('car-model');
    
    // --- 状態変数 ---
    let gameState = 'idle'; // 'idle'(待機), 'washing'(洗車中), 'result'(結果)
    let targetTime = 0; // ミリ秒単位
    let startTime = 0;
    let animationFrameId;
    let splatterTimeoutId;
    let splatterStopTime = 0; // 汚れの発生が止まる時間（目標時間から何ミリ秒前か）

    // --- デバッグ要素 ---
    const debugTime = document.getElementById('debug-time');
    const debugStop = document.getElementById('debug-stop');

    // --- 音声エフェクト (Web Audio API) ---
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    let audioCtx = null;
    let masterGain = null;
    
    function initAudio() {
        if (!audioCtx) {
            audioCtx = new AudioContext();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = 0.2; // 全体の音量
            masterGain.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playTone(freq, type, duration, vol = 1) {
        initAudio();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
        
        osc.connect(gain);
        gain.connect(masterGain);
        
        osc.start();
        osc.stop(audioCtx.currentTime + duration);
    }

    // 1. スタート時の音（明るい開始音）
    function playStartSE() {
        playTone(659.25, 'sine', 0.3, 0.8); // ミ
        setTimeout(() => playTone(880, 'sine', 0.6, 0.8), 100); // ラ
    }

    // 2. 洗車中の音（水とブラシのシュッシュッという音）
    let washingAudioNode = null;
    function startWashingSE() {
        initAudio();
        const bufferSize = audioCtx.sampleRate * 2;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1; // ホワイトノイズ
        }
        
        const noiseSource = audioCtx.createBufferSource();
        noiseSource.buffer = buffer;
        noiseSource.loop = true;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 800; // くぐもった水の音
        
        // ブラシが回転するようなうねり（LFO）を追加
        const lfo = audioCtx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = 4; // 4Hzの回転音
        const lfoGain = audioCtx.createGain();
        lfoGain.gain.value = 600;
        lfo.connect(lfoGain);
        lfoGain.connect(filter.frequency);
        lfo.start();
        
        const gain = audioCtx.createGain();
        gain.gain.value = 0.4;
        
        noiseSource.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);
        
        noiseSource.start();
        washingAudioNode = { noiseSource, lfo, gain };
    }

    function stopWashingSE() {
        if (washingAudioNode) {
            // フェードアウトして止める
            washingAudioNode.gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
            setTimeout(() => {
                if(washingAudioNode) {
                    washingAudioNode.noiseSource.stop();
                    washingAudioNode.lfo.stop();
                    washingAudioNode = null;
                }
            }, 500);
        }
    }

    // 3. 結果の音
    function playResultSE(type) {
        if (type === 'success') {
            // キラキラした成功音（アルペジオ）
            [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
                setTimeout(() => playTone(freq, 'sine', 1.0, 0.6), i * 80);
            });
        } else if (type === 'warning') {
            // 残念な音（プー、プー）
            playTone(200, 'square', 0.5, 0.4);
            setTimeout(() => playTone(150, 'square', 0.8, 0.4), 300);
        } else if (type === 'danger') {
            // 壊れるような低音ノイズ
            playTone(80, 'sawtooth', 1.5, 0.7);
            playTone(150, 'square', 1.0, 0.5);
        }
    }

    // 4. 次へボタンの音
    function playNextSE() {
        playTone(440, 'triangle', 0.2, 0.6);
        setTimeout(() => playTone(554.37, 'triangle', 0.3, 0.6), 80);
    }

    // --- 設定 ---
    const CAR_TYPES = [
        { type: 'compact', width: 220, minTime: 8, maxTime: 11 },
        { type: 'sedan', width: 300, minTime: 10, maxTime: 14 },
        { type: 'limo', width: 440, minTime: 14, maxTime: 18 }
    ];
    
    const COLORS = [
        '#ff3366', // ピンク/赤
        '#33ccff', // 水色
        '#ffcc00', // 黄色
        '#ff8833', // オレンジ
        '#9933ff', // 紫
        '#ffffff', // 白
        '#44ff44'  // ネオングリーン
    ];

    // --- ゲームロジック ---
    function setupNewGame() {
        // 1. 車種（長さ）と色をランダムに設定
        const carDef = CAR_TYPES[Math.floor(Math.random() * CAR_TYPES.length)];
        const carColor = COLORS[Math.floor(Math.random() * COLORS.length)];
        
        document.documentElement.style.setProperty('--car-color', carColor);
        carModel.style.width = `${carDef.width}px`;
        
        // 2. 目標時間を車の長さに応じてランダム設定
        targetTime = (Math.random() * (carDef.maxTime - carDef.minTime) + carDef.minTime) * 1000;
        
        // 3. UIのリセット
        targetDisplay.textContent = (targetTime / 1000).toFixed(2).padStart(5, '0') + 's';
        currentDisplay.textContent = '00.00s';
        currentDisplay.classList.remove('fade-out');
        
        // 汚れの停止時間をランダムにし、特定の秒数固定による攻略を防ぐ（500ms ~ 2000ms）
        splatterStopTime = Math.random() * 1500 + 500;
        if(debugStop) debugStop.textContent = (splatterStopTime / 1000).toFixed(2);
        
        // 車体を完全に汚れた状態にリセット
        carModel.className = 'car-model is-dirty';
        
        // 洗車機の状態をリセット
        machine.classList.remove('is-on');
        machine.classList.add('is-auto-moving'); // 初期位置へ滑らかに移動
        machine.style.left = '10%';
        setTimeout(() => {
            if (gameState === 'idle') machine.classList.remove('is-auto-moving');
        }, 1000);
        
        // 古い汚れ（スプラッター）をクリア
        const splatterContainer = document.getElementById('splatter-container');
        if (splatterContainer) splatterContainer.innerHTML = '';
        clearTimeout(splatterTimeoutId);
        
        // ボタンと結果パネルのリセット
        resultMessage.classList.add('hidden');
        resultMessage.className = 'result-message hidden';
        
        startBtn.disabled = false;
        stopBtn.disabled = true;
        nextBtn.classList.add('hidden');
        
        gameState = 'idle';
    }

    function updateTimer() {
        if (gameState !== 'washing') return;
        
        // 汚れの当たり判定チェック
        checkSplatters();
        
        const now = performance.now();
        const elapsed = now - startTime;
        
        // 核心の仕組み：3秒経過でタイマーをフェードアウト
        if (elapsed > 3000 && !currentDisplay.classList.contains('fade-out')) {
            currentDisplay.classList.add('fade-out');
        }
        
        // 表示の更新（フェードアウト後も見えないだけでDOM自体は更新し続ける）
        currentDisplay.textContent = (elapsed / 1000).toFixed(2).padStart(5, '0') + 's';
        
        // デバッグ用表示
        if(debugTime) debugTime.textContent = (elapsed / 1000).toFixed(2);
        
        animationFrameId = requestAnimationFrame(updateTimer);
    }

    function startGame() {
        if (gameState !== 'idle') return;
        
        gameState = 'washing';
        startTime = performance.now();
        
        startBtn.disabled = true;
        stopBtn.disabled = false;
        
        machine.classList.add('is-on');
        
        playStartSE();
        startWashingSE();
        
        animationFrameId = requestAnimationFrame(updateTimer);
        
        // 汚れのランダム発生を開始
        splatterTimeoutId = setTimeout(spawnSplatter, 1000);
    }

    function spawnSplatter() {
        if (gameState !== 'washing') return;
        
        const now = performance.now();
        const elapsed = now - startTime;
        const remaining = targetTime - elapsed;
        
        // 汚れの停止時間をランダムにし、一定秒数による裏技攻略を防ぐ
        if (remaining < splatterStopTime) {
            const nextDelay = Math.random() * 800 + 600; // 600 - 1400ms
            splatterTimeoutId = setTimeout(spawnSplatter, nextDelay);
            return;
        }

        const container = document.getElementById('splatter-container');
        if (!container) return;
        
        const s = document.createElement('div');
        s.className = 'splatter';
        s.dataset.health = "100"; // 汚れの耐久値
        
        const carWidth = carModel.offsetWidth;
        // 車体の長さ内のどこかにランダムに配置
        const x = Math.random() * (carWidth * 0.8) + (carWidth * 0.1);
        const y = Math.random() * 80 + 20; // 床から 20px - 100px の範囲
        const size = Math.random() * 15 + 25; // 25px - 40px のサイズ
        
        s.style.width = `${size}px`;
        s.style.height = `${size}px`;
        s.style.left = `${x}px`;
        s.style.bottom = `${y}px`;
        s.style.setProperty('--rot', `${Math.random() * 360}deg`);
        
        container.appendChild(s);
        
        // アニメーションのトリガー
        requestAnimationFrame(() => {
            s.classList.add('splat-in');
        });
        
        // 次の汚れ発生までの待ち時間
        const nextDelay = Math.random() * 800 + 600; // 600 - 1400ms
        splatterTimeoutId = setTimeout(spawnSplatter, nextDelay);
    }

    function checkSplatters() {
        const machineRect = machine.getBoundingClientRect();
        const splatters = document.querySelectorAll('.splatter:not(.cleaned)');
        splatters.forEach(s => {
            const sr = s.getBoundingClientRect();
            // 寛大な境界ボックスでオーバーラップの確認
            if (sr.right > machineRect.left && sr.left < machineRect.right &&
                sr.bottom > machineRect.top && sr.top < machineRect.bottom) {
                
                let health = parseFloat(s.dataset.health || "100");
                health -= 5.5; // 約0.3秒ほどの継続的な擦り合わせで汚れが落ちる
                
                if (health <= 0) {
                    s.classList.add('cleaned');
                    setTimeout(() => s.remove(), 300);
                } else {
                    s.dataset.health = health.toString();
                    const ratio = health / 100;
                    s.style.opacity = ratio; // 擦るほど薄くなる
                    s.style.setProperty('--scale', 0.5 + 0.5 * ratio); // 擦るほど少し小さくなる
                }
            }
        });
    }

    function stopGame() {
        if (gameState !== 'washing') return;
        clearTimeout(splatterTimeoutId);
        
        gameState = 'result';
        cancelAnimationFrame(animationFrameId);
        
        machine.classList.remove('is-on');
        stopWashingSE();
        
        const now = performance.now();
        const elapsed = now - startTime;
        const diffSeconds = (elapsed - targetTime) / 1000;
        
        // 最終時間をすぐに表示し直す
        currentDisplay.classList.remove('fade-out');
        currentDisplay.textContent = (elapsed / 1000).toFixed(2).padStart(5, '0') + 's';
        
        stopBtn.disabled = true;
        
        // 結果を見せるために洗車機を横に避ける
        machine.classList.add('is-auto-moving');
        machine.style.left = '90%';
        
        // 差分を評価した結果を表示
        showResult(diffSeconds);
    }

    function showResult(diff) {
        let title = '';
        let desc = '';
        let resultClass = '';
        
        const activeSplatters = document.querySelectorAll('.splatter:not(.cleaned)').length;

        if (Math.abs(diff) <= 0.5) {
            // ピッタリの時間（誤差±0.5s以内）
            if (activeSplatters > 0) {
                title = '時間ピッタリ…でも汚れが！';
                const diffStr = Math.abs(diff).toFixed(2);
                desc = `誤差わずか ${diffStr}秒！時間は完璧でしたが、汚れを ${activeSplatters} 箇所見逃しています！`;
                carModel.className = 'car-model is-dirty'; // 汚れを残す
                resultClass = 'warning';
            } else {
                title = '完璧！ピカピカです！ ✦';
                const diffStr = Math.abs(diff).toFixed(2);
                desc = `誤差わずか ${diffStr}秒！汚れも全て落として完璧な洗車です！`;
                carModel.className = 'car-model is-perfect';
                resultClass = 'success';
            }
        } else if (diff < -0.5) {
            // 早すぎた場合
            title = '早すぎ！洗い残しあり';
            const diffStr = Math.abs(diff).toFixed(2);
            desc = `目標より ${diffStr}秒 早かったため、泥が残ってしまいました…。`;
            carModel.className = 'car-model is-dirty'; // 汚れを残す
            resultClass = 'warning';
        } else {
            // 遅すぎた場合
            title = '遅すぎ！洗いすぎで破損';
            const diffStr = Math.abs(diff).toFixed(2);
            desc = `目標より ${diffStr}秒 遅かったため、ブラシで車体が傷ついてしまいました…。`;
            carModel.className = 'car-model is-damaged'; // ダメージ表現の適用
            resultClass = 'danger';
        }
        
        // DOMの更新
        resultTitle.textContent = title;
        resultDesc.textContent = desc;
        resultMessage.className = `result-message ${resultClass}`;
        
        // 結果に応じたSEを再生
        playResultSE(resultClass);
        
        // ドラマチックな演出のため「次の車へ」ボタンを少し遅らせる
        setTimeout(() => {
            nextBtn.classList.remove('hidden');
        }, 800);
    }

    // --- イベントリスナー ---
    startBtn.addEventListener('click', () => {
        initAudio(); // ユーザー操作でAudioContextを確実にする
        startGame();
    });
    stopBtn.addEventListener('click', stopGame);
    nextBtn.addEventListener('click', () => {
        playNextSE(); // 次へのSEを再生
        setupNewGame();
    });

    // --- 洗車機のドラッグロジック（マウス＆タッチ） ---
    let isDragging = false;
    let startX = 0;
    let machineStartLeft = 0;
    
    // 操作感を上げるため、常にドラッグ可能にする
    machine.addEventListener('pointerdown', (e) => {
        isDragging = true;
        startX = e.clientX;
        machineStartLeft = machine.offsetLeft;
        
        machine.classList.add('is-dragging');
        machine.classList.remove('is-auto-moving'); // ドラッグ中の遷移アニメーションを防ぐ
        machine.setPointerCapture(e.pointerId);
    });

    machine.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        
        const dx = e.clientX - startX;
        let newLeft = machineStartLeft + dx;
        
        // 画面外への移動を制限
        const halfWidth = machine.offsetWidth / 2;
        const maxLeft = stage.clientWidth - halfWidth;
        const minLeft = halfWidth;
        
        newLeft = Math.max(minLeft, Math.min(maxLeft, newLeft));
        machine.style.left = `${newLeft}px`;
    });

    const stopDragging = (e) => {
        isDragging = false;
        machine.classList.remove('is-dragging');
        if (e && e.pointerId) machine.releasePointerCapture(e.pointerId);
    };

    machine.addEventListener('pointerup', stopDragging);
    machine.addEventListener('pointercancel', stopDragging);

    // 初期化
    setupNewGame();
});
