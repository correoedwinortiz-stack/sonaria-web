/**
 * app.js - Lógica de Sonaría Radio Landing Page
 */

class SonariaLanding {
    constructor() {
        this.streamUrl = 'https://radio.sonariaradio.online/radio.mp3';
        this.audio = new Audio();
        this.audio.crossOrigin = "anonymous";
        this.isPlaying = false;

        // Elementos UI
        this.playBtn = document.getElementById('play-btn');
        this.playIcon = document.getElementById('play-icon');
        this.disk = document.getElementById('disk');
        this.visualizer = document.getElementById('visualizer');
        this.volumeSlider = document.getElementById('volume-slider');
        this.trackTitle = document.getElementById('track-title');

        this.initListeners();
        this.checkInterval = null;
        this.reconnectTimer = null;
    }

    initListeners() {
        this.playBtn.addEventListener('click', () => this.togglePlay());
        
        this.volumeSlider.addEventListener('input', (e) => {
            this.audio.volume = e.target.value;
        });

        this.audio.addEventListener('playing', () => {
            this.trackTitle.textContent = "Transmitiendo en Vivo";
            this.setPlayingState(true);
            this.stopReconnectTimer();
            this.startStallCheck();
        });

        this.audio.addEventListener('pause', () => {
            this.setPlayingState(false);
            this.stopStallCheck();
        });

        this.audio.addEventListener('error', () => this.handleConnectionError("Error de señal"));
        this.audio.addEventListener('stalled', () => this.handleConnectionError("Señal débil..."));
    }

    handleConnectionError(msg) {
        if (!this.isPlaying) return;
        
        console.warn("📡 [Radio] " + msg + ". Intentando reconectar...");
        this.trackTitle.textContent = msg + " - Reconectando...";
        
        this.stopReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
            this.togglePlay(true); // Forzar reinicio
        }, 5000); // Reintentar cada 5 segundos
    }

    stopReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    startStallCheck() {
        this.stopStallCheck();
        let lastTime = 0;
        this.checkInterval = setInterval(() => {
            if (this.isPlaying && this.audio.currentTime === lastTime) {
                this.handleConnectionError("Señal perdida");
            }
            lastTime = this.audio.currentTime;
        }, 10000); // Verificar cada 10 segundos si el tiempo avanza
    }

    stopStallCheck() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }

    togglePlay(forceReconnect = false) {
        if (this.isPlaying && !forceReconnect) {
            this.audio.pause();
            this.audio.src = ""; 
        } else {
            this.trackTitle.textContent = "Conectando...";
            this.audio.src = this.streamUrl + '?t=' + Date.now();
            this.audio.play().catch(err => {
                this.handleConnectionError("Reintentando");
            });
        }
    }

    setPlayingState(playing) {
        this.isPlaying = playing;
        
        if (playing) {
            this.playIcon.setAttribute('data-lucide', 'pause');
            this.disk.classList.add('animate-spin-slow');
            this.visualizer.classList.add('active');
        } else {
            this.playIcon.setAttribute('data-lucide', 'play');
            this.disk.classList.remove('animate-spin-slow');
            this.visualizer.classList.remove('active');
        }
        
        // Actualizar iconos de Lucide
        lucide.createIcons();
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    new SonariaLanding();
});
