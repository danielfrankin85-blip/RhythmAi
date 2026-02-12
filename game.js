// Game State
const gameState = {
    score: 0,
    combo: 0,
    maxCombo: 0,
    multiplier: 1,
    isPlaying: false,
    notes: [],
    speed: 3,
    spawnInterval: null,
    updateInterval: null
};

// Game Configuration
const config = {
    lanes: ['a', 's', 'd', 'f'],
    targetZoneY: window.innerHeight - 200,
    hitTolerance: 50,
    perfectTolerance: 20,
    noteSpeed: 3,
    spawnRate: 800
};

// DOM Elements
const scoreEl = document.getElementById('score');
const comboEl = document.getElementById('combo');
const multiplierEl = document.getElementById('multiplier');
const menuEl = document.getElementById('menu');
const gameOverEl = document.getElementById('gameOver');
const instructionsEl = document.getElementById('instructions');
const finalScoreEl = document.getElementById('finalScore');
const maxComboEl = document.getElementById('maxCombo');
const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');
const instructionsBtn = document.getElementById('instructionsBtn');
const backBtn = document.getElementById('backBtn');
const lanes = document.querySelectorAll('.lane');

// Event Listeners
startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', restartGame);
instructionsBtn.addEventListener('click', showInstructions);
backBtn.addEventListener('click', hideInstructions);

document.addEventListener('keydown', handleKeyPress);
document.addEventListener('keyup', handleKeyRelease);

// Initialize
function init() {
    updateUI();
}

// Start Game
function startGame() {
    menuEl.style.display = 'none';
    gameState.isPlaying = true;
    gameState.score = 0;
    gameState.combo = 0;
    gameState.maxCombo = 0;
    gameState.multiplier = 1;
    gameState.notes = [];
    
    updateUI();
    
    // Start spawning notes
    gameState.spawnInterval = setInterval(spawnNote, config.spawnRate);
    
    // Start game loop
    gameState.updateInterval = setInterval(updateGame, 16); // ~60 FPS
}

// Restart Game
function restartGame() {
    gameOverEl.style.display = 'none';
    startGame();
}

// Show/Hide Instructions
function showInstructions() {
    menuEl.style.display = 'none';
    instructionsEl.style.display = 'block';
}

function hideInstructions() {
    instructionsEl.style.display = 'none';
    menuEl.style.display = 'block';
}

// Spawn Note
function spawnNote() {
    if (!gameState.isPlaying) return;
    
    const laneIndex = Math.floor(Math.random() * config.lanes.length);
    const lane = lanes[laneIndex];
    
    const note = document.createElement('div');
    note.className = `note lane-${laneIndex}`;
    note.dataset.lane = laneIndex;
    note.dataset.y = 0;
    
    lane.appendChild(note);
    
    gameState.notes.push({
        element: note,
        lane: laneIndex,
        y: 0,
        hit: false
    });
}

// Update Game Loop
function updateGame() {
    if (!gameState.isPlaying) return;
    
    // Update all notes
    gameState.notes.forEach((note, index) => {
        note.y += config.noteSpeed;
        note.element.style.top = note.y + 'px';
        
        // Remove notes that are off screen
        if (note.y > window.innerHeight + 50) {
            if (!note.hit) {
                missNote();
            }
            note.element.remove();
            gameState.notes.splice(index, 1);
        }
    });
    
    // Check if game should end (optional: add song duration logic here)
}

// Handle Key Press
function handleKeyPress(e) {
    if (!gameState.isPlaying) return;
    
    const key = e.key.toLowerCase();
    const laneIndex = config.lanes.indexOf(key);
    
    if (laneIndex === -1) return;
    
    // Visual feedback
    const keyHints = document.querySelectorAll('.key-hint');
    keyHints[laneIndex].classList.add('active');
    
    // Check for note hit
    checkNoteHit(laneIndex);
}

// Handle Key Release
function handleKeyRelease(e) {
    const key = e.key.toLowerCase();
    const laneIndex = config.lanes.indexOf(key);
    
    if (laneIndex === -1) return;
    
    const keyHints = document.querySelectorAll('.key-hint');
    keyHints[laneIndex].classList.remove('active');
}

// Check Note Hit
function checkNoteHit(laneIndex) {
    const notesInLane = gameState.notes.filter(
        note => note.lane === laneIndex && !note.hit
    );
    
    if (notesInLane.length === 0) return;
    
    // Find closest note to target zone
    let closestNote = null;
    let closestDistance = Infinity;
    
    notesInLane.forEach(note => {
        const distance = Math.abs(note.y - config.targetZoneY);
        if (distance < closestDistance) {
            closestDistance = distance;
            closestNote = note;
        }
    });
    
    // Check if within hit tolerance
    if (closestDistance <= config.hitTolerance) {
        hitNote(closestNote, closestDistance);
    }
}

// Hit Note
function hitNote(note, distance) {
    note.hit = true;
    note.element.remove();
    
    // Determine hit quality
    let points = 0;
    let feedback = '';
    
    if (distance <= config.perfectTolerance) {
        points = 100;
        feedback = 'PERFECT!';
        showFeedback(feedback, 'perfect');
    } else {
        points = 50;
        feedback = 'GOOD!';
        showFeedback(feedback, 'good');
    }
    
    // Update combo
    gameState.combo++;
    if (gameState.combo > gameState.maxCombo) {
        gameState.maxCombo = gameState.combo;
    }
    
    // Update multiplier
    if (gameState.combo >= 30) {
        gameState.multiplier = 4;
    } else if (gameState.combo >= 20) {
        gameState.multiplier = 3;
    } else if (gameState.combo >= 10) {
        gameState.multiplier = 2;
    } else {
        gameState.multiplier = 1;
    }
    
    // Update score
    gameState.score += points * gameState.multiplier;
    
    updateUI();
}

// Miss Note
function missNote() {
    gameState.combo = 0;
    gameState.multiplier = 1;
    showFeedback('MISS!', 'miss');
    updateUI();
}

// Show Feedback
function showFeedback(text, type) {
    const feedback = document.createElement('div');
    feedback.className = `hit-feedback ${type}`;
    feedback.textContent = text;
    document.querySelector('.game-area').appendChild(feedback);
    
    setTimeout(() => feedback.remove(), 500);
}

// Update UI
function updateUI() {
    scoreEl.textContent = gameState.score;
    comboEl.textContent = gameState.combo;
    multiplierEl.textContent = gameState.multiplier;
}

// End Game
function endGame() {
    gameState.isPlaying = false;
    clearInterval(gameState.spawnInterval);
    clearInterval(gameState.updateInterval);
    
    // Clear remaining notes
    gameState.notes.forEach(note => note.element.remove());
    gameState.notes = [];
    
    // Show game over screen
    finalScoreEl.textContent = gameState.score;
    maxComboEl.textContent = gameState.maxCombo;
    gameOverEl.style.display = 'block';
}

// Optional: Add end game after certain time (e.g., 60 seconds)
// setTimeout(() => { if (gameState.isPlaying) endGame(); }, 60000);

init();
