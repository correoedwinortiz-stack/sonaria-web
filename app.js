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
    }

    initListeners() {
        this.playBtn.addEventListener('click', () => this.togglePlay());
        
        this.volumeSlider.addEventListener('input', (e) => {
            this.audio.volume = e.target.value;
        });

        this.audio.addEventListener('playing', () => {
            this.trackTitle.textContent = "Transmitiendo en Vivo";
            this.setPlayingState(true);
        });

        this.audio.addEventListener('pause', () => {
            this.setPlayingState(false);
        });

        this.audio.addEventListener('error', () => {
            this.trackTitle.textContent = "Señal no disponible";
            this.setPlayingState(false);
        });
    }

    togglePlay() {
        if (this.isPlaying) {
            this.audio.pause();
            this.audio.src = ""; // Liberar buffer
        } else {
            this.trackTitle.textContent = "Conectando...";
            this.audio.src = this.streamUrl + '?t=' + Date.now();
            this.audio.play().catch(err => {
                console.error("Error Play:", err);
                this.trackTitle.textContent = "Error de conexión";
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
