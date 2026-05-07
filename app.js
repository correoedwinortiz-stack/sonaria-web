/**
 * app.js - Lógica de Sonaría Radio Landing Page (v2 - Ultra-Robusta)
 * 
 * Mejoras:
 * - Reconexión automática inteligente con backoff exponencial
 * - Tolerancia a gaps entre canciones (no reconecta por silencios cortos)
 * - Watchdog basado en bytes recibidos (no en currentTime)
 * - Prevención de reconexiones infinitas
 */

class SonariaLanding {
    constructor() {
        this.streamUrl = 'http://212.84.160.3:5789/stream';
        this.audio = null;
        this.isPlaying = false;
        this.userWantsPlay = false; // Intención del usuario (separada del estado real)

        // Reconexión inteligente
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 50;
        this.reconnectTimer = null;
        this.watchdogTimer = null;
        this.lastDataTime = 0;

        // Elementos UI
        this.playBtn = document.getElementById('play-btn');
        this.disk = document.getElementById('disk');
        this.visualizer = document.getElementById('visualizer');
        this.volumeSlider = document.getElementById('volume-slider');
        this.trackTitle = document.getElementById('track-title');

        this.initListeners();
    }

    createAudio() {
        // Crear un nuevo elemento Audio limpio para cada conexión
        if (this.audio) {
            this.audio.pause();
            this.audio.removeAttribute('src');
            this.audio.load();
        }
        this.audio = new Audio();
        this.audio.crossOrigin = "anonymous";
        this.audio.volume = this.volumeSlider ? this.volumeSlider.value : 0.8;
        this.audio.preload = "none";

        // Guardar referencia al audio creado para que los closures puedan validar si siguen activos
        const audioEl = this.audio;

        // Eventos
        audioEl.addEventListener('playing', () => {
            if (this.audio !== audioEl) return; // Instancia obsoleta, ignorar
            this.reconnectAttempts = 0;
            this.lastDataTime = Date.now();
            this.trackTitle.textContent = "Transmitiendo en Vivo";
            this.setPlayingState(true);
            this.startWatchdog();
        });

        audioEl.addEventListener('waiting', () => {
            if (this.audio !== audioEl) return;
            if (this.userWantsPlay) {
                this.trackTitle.textContent = "Cargando buffer...";
            }
        });

        audioEl.addEventListener('error', (e) => {
            if (this.audio !== audioEl) return; // Instancia destruida al pausar, ignorar
            const code = audioEl.error?.code;
            console.warn("📡 [Radio] Error de audio, código:", code);
            if (this.userWantsPlay) {
                this.scheduleReconnect("Error de señal");
            }
        });

        // 'stalled' no siempre significa desconexión - ser más tolerante
        audioEl.addEventListener('stalled', () => {
            if (this.audio !== audioEl) return;
            if (this.userWantsPlay && Date.now() - this.lastDataTime > 30000) {
                this.scheduleReconnect("Señal débil");
            }
        });

        // Detectar cuando sí recibimos datos
        audioEl.addEventListener('timeupdate', () => {
            if (this.audio !== audioEl) return;
            this.lastDataTime = Date.now();
            this.reconnectAttempts = 0;
        });

        audioEl.addEventListener('progress', () => {
            if (this.audio !== audioEl) return;
            this.lastDataTime = Date.now();
        });
    }

    initListeners() {
        this.playBtn.addEventListener('click', () => this.togglePlay());
        
        this.volumeSlider.addEventListener('input', (e) => {
            if (this.audio) this.audio.volume = e.target.value;
        });
    }

    scheduleReconnect(reason) {
        if (!this.userWantsPlay) return;
        if (this.reconnectTimer) return; // Ya hay un reintento programado
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.trackTitle.textContent = "Sin señal - Toca para reintentar";
            this.setPlayingState(false);
            this.userWantsPlay = false;
            return;
        }

        this.reconnectAttempts++;
        
        // Backoff exponencial: 3s, 5s, 8s, 10s, 10s, 10s...
        const delay = Math.min(3000 + (this.reconnectAttempts * 2000), 10000);
        
        console.log(`📡 [Radio] ${reason}. Reintento #${this.reconnectAttempts} en ${delay/1000}s`);
        this.trackTitle.textContent = `${reason} - Reconectando...`;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.userWantsPlay) {
                this.connectStream();
            }
        }, delay);
    }

    connectStream() {
        this.createAudio();
        this.trackTitle.textContent = "Conectando...";
        this.setPlayingState(true); // Mostrar icono de pausa/carga inmediatamente
        
        // Cache-busting para evitar datos obsoletos en proxies/Cloudflare
        this.audio.src = this.streamUrl + '?nocache=' + Date.now();
        
        const playPromise = this.audio.play();
        if (playPromise) {
            playPromise.catch(err => {
                console.warn("📡 [Radio] Error al iniciar reproducción:", err.message);
                if (this.userWantsPlay) {
                    this.scheduleReconnect("Reintentando conexión");
                } else {
                    this.setPlayingState(false);
                }
            });
        }
    }

    togglePlay() {
        if (this.userWantsPlay) {
            // DETENER - primero apagar la intención para que ningún handler reactive la conexión
            this.userWantsPlay = false;
            this.stopWatchdog();
            this.clearReconnectTimer();

            // Desconectar el audio de forma limpia
            if (this.audio) {
                const audioToStop = this.audio;
                this.audio = null; // Desreferenciar ANTES para que los handlers no actúen
                audioToStop.pause();
                audioToStop.removeAttribute('src');
            }

            this.setPlayingState(false);
            this.trackTitle.textContent = "Radio detenida";
            this.reconnectAttempts = 0;
        } else {
            // REPRODUCIR
            this.userWantsPlay = true;
            this.reconnectAttempts = 0;
            this.setPlayingState(true); // UI Inmediata
            this.connectStream();
        }
    }

    startWatchdog() {
        this.stopWatchdog();
        this.lastDataTime = Date.now();
        
        this.watchdogTimer = setInterval(() => {
            if (!this.userWantsPlay || !this.isPlaying) return;

            const silenceDuration = Date.now() - this.lastDataTime;
            
            // Si llevamos 45 segundos sin timeupdate/progress, reconectar
            // (Tolerante a silencios entre canciones que duran ~10-20s)
            if (silenceDuration > 45000) {
                console.warn("📡 [Radio] Watchdog: Sin datos por 45s, forzando reconexión");
                this.stopWatchdog();
                this.scheduleReconnect("Señal perdida");
            }
        }, 5000); // Verificar cada 5s
    }

    stopWatchdog() {
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    setPlayingState(playing) {
        try {
            this.isPlaying = playing;
            
            if (!this.playBtn) {
                this.playBtn = document.getElementById('play-btn');
            }

            if (this.playBtn) {
                // SVGs directos para evitar errores de librerías externas
                const playSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                const pauseSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
                
                this.playBtn.innerHTML = playing ? pauseSVG : playSVG;
            }

            // Actualizar animaciones si los elementos existen
            if (this.disk) {
                if (playing) this.disk.classList.add('animate-spin-slow');
                else this.disk.classList.remove('animate-spin-slow');
            }

            if (this.visualizer) {
                if (playing) this.visualizer.classList.add('active');
                else this.visualizer.classList.remove('active');
            }
        } catch (err) {
            console.error("❌ [UI] Error al actualizar interfaz:", err);
        }
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    new SonariaLanding();
});
