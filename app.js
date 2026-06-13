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
        this.streamUrl = 'https://radio.sonariaradio.online/radio.mp3';
        this.audio = null;
        this.isPlaying = false;
        this.userWantsPlay = false; // Intención del usuario (separada del estado real)

        // Reconexión inteligente
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 999999; // Reintentos infinitos
        this.reconnectTimer = null;
        this.watchdogTimer = null;
        this.lastDataTime = 0;

        // Audio de emergencia (3 pistas alternadas)
        this.emergencyAudio = null;
        this.emergencyUrls = [
            'assets/audio/emergencia1.mp3',
            'assets/audio/emergencia2.mp3',
            'assets/audio/emergencia3.mp3'
        ];
        this.currentEmergencyIndex = 0;
        this.connectionStartTime = 0;

        // Elementos UI
        this.playBtn = document.getElementById('play-btn');
        this.disk = document.getElementById('disk');
        this.visualizer = document.getElementById('visualizer');
        this.volumeSlider = document.getElementById('volume-slider');
        this.trackTitle = document.getElementById('track-title');
        this.metadataTimer = null;

        this.initListeners();
        this.startMetadataUpdates();
    }

    createAudio() {
        // Crear un nuevo elemento Audio limpio para cada conexión
        if (this.audio) {
            this.audio.pause();
            this.audio.removeAttribute('src');
            this.audio.load();
        }
        this.audio = new Audio();
        // this.audio.crossOrigin = "anonymous"; // Desactivado para evitar bloqueos CORS con Icecast nativo
        this.audio.volume = this.volumeSlider ? this.volumeSlider.value : 0.8;
        this.audio.preload = "none";

        // Guardar referencia al audio creado para que los closures puedan validar si siguen activos
        const audioEl = this.audio;

        // Eventos
        audioEl.addEventListener('waiting', () => {
            if (this.audio !== audioEl) return;
            if (this.userWantsPlay) {
                this.trackTitle.textContent = "Cargando buffer...";

                // Si esperamos más de 7 segundos cargando, disparar emergencia
                this.waitingTimer = setTimeout(() => {
                    if (this.audio === audioEl && this.userWantsPlay) {
                        this.scheduleReconnect("Buffer agotado");
                    }
                }, 7000);
            }
        });

        audioEl.addEventListener('playing', () => {
            if (this.audio !== audioEl) return;
            if (this.waitingTimer) clearTimeout(this.waitingTimer);
            this.reconnectAttempts = 0;
            this.lastDataTime = Date.now();

            // Forzar actualización de metadatos inmediata para quitar "Cargando buffer..."
            this.updateMetadata();

            this.setPlayingState(true);
            this.startWatchdog();
            this.stopEmergency(); // Detener audio de emergencia si estaba sonando
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
            // Si el stream se atasca por más de 8 segundos, intentar reconectar
            if (this.userWantsPlay && Date.now() - this.lastDataTime > 8000) {
                this.scheduleReconnect("Señal estancada");
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

        // Backoff exponencial más agresivo: 2s, 4s, 6s... máx 10s
        const delay = Math.min(2000 + (this.reconnectAttempts * 1000), 10000);

        console.log(`📡 [Radio] ${reason}. Reintento #${this.reconnectAttempts} en ${delay / 1000}s`);
        this.trackTitle.textContent = `${reason} - Reconectando...`;

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.userWantsPlay) {
                this.connectStream();
            }
        }, delay);

        this.startEmergency(); // Iniciar audio de emergencia mientras reconecta
    }

    startEmergency() {
        if (!this.userWantsPlay) return;
        if (this.emergencyAudio && !this.emergencyAudio.paused) return;

        console.log("📢 [Radio] Iniciando audio de emergencia...");
        if (!this.emergencyAudio) {
            this.emergencyAudio = new Audio();
            this.emergencyAudio.volume = this.volumeSlider ? this.volumeSlider.value : 0.8;
            // Al terminar cada pista, pasar a la siguiente
            this.emergencyAudio.addEventListener('ended', () => {
                this.currentEmergencyIndex = (this.currentEmergencyIndex + 1) % this.emergencyUrls.length;
                this.emergencyAudio.src = this.emergencyUrls[this.currentEmergencyIndex];
                this.emergencyAudio.play().catch(() => { });
            });
        }

        if (this.emergencyAudio.paused) {
            this.emergencyAudio.src = this.emergencyUrls[this.currentEmergencyIndex];
            this.emergencyAudio.play().catch(err => {
                console.warn("⚠️ [Radio] No se pudo reproducir el audio de emergencia:", err.message);
            });
        }
    }

    stopEmergency() {
        if (this.emergencyAudio) {
            console.log("⏹️ [Radio] Deteniendo audio de emergencia.");
            this.emergencyAudio.pause();
            this.emergencyAudio.currentTime = 0;
        }
    }

    connectStream() {
        this.createAudio();
        this.trackTitle.textContent = "Conectando...";
        this.setPlayingState(true);
        this.connectionStartTime = Date.now();
        this.startWatchdog(); // Iniciar watchdog desde el intento de conexión

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
            this.stopEmergency(); // Asegurar que el audio de emergencia se detenga
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
            const now = Date.now();

            // Caso 1: Estaba sonando y se cortó el flujo (> 15s)
            if (this.userWantsPlay && this.isPlaying && now - this.lastDataTime > 15000) {
                console.warn("📡 [Radio] Watchdog: Sin datos por 15s, forzando reconexión");
                this.stopWatchdog();
                this.scheduleReconnect("Señal perdida");
            }
            // Caso 2: Intentando conectar sin éxito (> 2s) → emergencia inmediata
            if (this.userWantsPlay && !this.isPlaying && now - this.connectionStartTime > 2000) {
                console.warn("📡 [Radio] Watchdog: Sin conexión por 2s, activando emergencia");
                this.stopWatchdog();
                this.scheduleReconnect("Sin señal");
            }
        }, 500); // Verificar cada 500ms para respetar el umbral de 2s
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
            console.log("🎨 [UI] Cambiando estado a:", playing ? "Reproduciendo" : "Detenido");

            if (!this.playBtn) {
                this.playBtn = document.getElementById('play-btn');
            }

            if (this.playBtn) {
                // Inyectar el HTML del icono
                this.playBtn.innerHTML = playing ? '<i data-lucide="pause"></i>' : '<i data-lucide="play"></i>';

                // Forzar renderizado de Lucide
                if (window.lucide) {
                    window.lucide.createIcons();
                }
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

    startMetadataUpdates() {
        this.updateMetadata();
        this.metadataTimer = setInterval(() => this.updateMetadata(), 10000); // Cada 10s
    }

    async updateMetadata() {
        try {
            const response = await fetch('https://radio.sonariaradio.online/status-json.xsl');
            if (!response.ok) throw new Error("Fallo en red");
            const data = await response.json();

            if (data && data.icestats && data.icestats.source) {
                const source = data.icestats.source;
                let title = "";

                if (Array.isArray(source)) {
                    const radio = source.find(s => s.listenurl && s.listenurl.includes('/radio.mp3'));
                    title = radio ? radio.title : "";
                } else {
                    title = source.title || "";
                }

                if (this.trackTitle) {
                    let newTitle = title || "Transmitiendo en Vivo";

                    try {
                        if (newTitle.includes('Ã') || newTitle.includes('ð')) {
                            newTitle = decodeURIComponent(escape(newTitle));
                        }
                    } catch (e) {
                        newTitle = newTitle.replace(/Ã¡/g, 'á').replace(/Ã©/g, 'é').replace(/Ã­/g, 'í').replace(/Ã³/g, 'ó').replace(/Ãº/g, 'ú').replace(/Ã±/g, 'ñ');
                    }

                    if (this.trackTitle.textContent !== newTitle) {
                        this.trackTitle.textContent = newTitle;
                        console.log("🎶 Ahora suena:", newTitle);
                    }
                }
            } else if (this.trackTitle && this.trackTitle.textContent === "Cargando buffer...") {
                this.trackTitle.textContent = "Transmitiendo en Vivo";
            }
        } catch (err) {
            console.warn("⚠️ [Metadata] No se pudieron obtener los datos:", err.message);
            // Si falló pero estamos sonando, al menos quitemos el "Cargando..."
            if (this.trackTitle && this.trackTitle.textContent === "Cargando buffer...") {
                this.trackTitle.textContent = "Transmitiendo en Vivo";
            }
        }
    }
}

// --- Lógica de Peticiones Web ---
class SongRequestHandler {
    constructor() {
        this.form = document.getElementById('song-request-form');
        this.nameInput = document.getElementById('request-name');
        this.songInput = document.getElementById('request-song');
        this.submitBtn = document.getElementById('request-btn');
        this.statusMsg = document.getElementById('request-status');

        // ¡IMPORTANTE! Aquí debes pegar la URL de tu Cloudflare Worker
        this.API_URL = 'https://radio-bot.correo-edwin-ortiz.workers.dev';

        this.COOLDOWN_MINUTES = 5;

        if (this.form) {
            this.initListeners();
            this.checkCooldown();
        }
    }

    initListeners() {
        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRequest();
        });
    }

    checkCooldown() {
        const lastRequestTime = localStorage.getItem('sonaria_last_request');
        if (lastRequestTime) {
            const timePassed = Date.now() - parseInt(lastRequestTime);
            const cooldownMs = this.COOLDOWN_MINUTES * 60 * 1000;

            if (timePassed < cooldownMs) {
                const remainingMinutes = Math.ceil((cooldownMs - timePassed) / 60000);
                this.disableForm(`Por favor, espera ${remainingMinutes} minuto(s) para pedir otra canción.`);

                setTimeout(() => {
                    this.enableForm();
                }, cooldownMs - timePassed);
            }
        }
    }

    disableForm(message) {
        this.submitBtn.disabled = true;
        this.submitBtn.style.opacity = '0.5';
        this.submitBtn.style.cursor = 'not-allowed';
        this.showStatus(message, 'warning');
    }

    enableForm() {
        this.submitBtn.disabled = false;
        this.submitBtn.style.opacity = '1';
        this.submitBtn.style.cursor = 'pointer';
        this.showStatus('', '');
    }

    showStatus(message, type) {
        this.statusMsg.textContent = message;
        this.statusMsg.className = `status-message ${type}`;
        this.statusMsg.style.display = message ? 'block' : 'none';
    }

    async handleRequest() {
        const name = this.nameInput.value.trim();
        const song = this.songInput.value.trim();

        if (!name || !song) return;

        this.disableForm("Enviando petición...");

        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name, song })
            });

            const data = await response.json().catch(() => ({}));

            if (response.ok) {
                this.showStatus("¡Petición enviada a la cabina con éxito!", "success");
                this.nameInput.value = '';
                this.songInput.value = '';

                localStorage.setItem('sonaria_last_request', Date.now().toString());

                setTimeout(() => {
                    this.enableForm();
                }, this.COOLDOWN_MINUTES * 60 * 1000);
            } else {
                if (response.status === 429) {
                    this.showStatus("Has superado el límite de peticiones. Espera unos minutos.", "error");
                } else {
                    this.showStatus(data.error || "Error al enviar la petición. Intenta más tarde.", "error");
                }

                setTimeout(() => {
                    this.enableForm();
                }, 5000);
            }
        } catch (error) {
            console.error("Error al enviar petición:", error);
            this.showStatus("Error de conexión. Asegúrate de configurar la URL del API.", "error");
            setTimeout(() => {
                this.enableForm();
            }, 5000);
        }
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    new SonariaLanding();
    new SongRequestHandler();
});
