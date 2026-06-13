export default {
  async fetch(request, env, ctx) {
    // 1. Manejo de CORS (Permite a tu web comunicarse con este Worker)
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Respuesta rápida a las peticiones preflight del navegador
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Método no permitido" }), { 
        status: 405, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    try {
      // 2. Leer los datos enviados desde la web
      const data = await request.json();
      const name = data.name?.trim();
      const song = data.song?.trim();

      if (!name || !song) {
        return new Response(JSON.stringify({ error: "Nombre y canción requeridos." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. Preparar mensaje para Telegram
      // El Token y el Chat ID se deben configurar como variables de entorno (Secrets) en Cloudflare
      const botToken = env.TELEGRAM_BOT_TOKEN; 
      // Si no configuras TELEGRAM_CHAT_ID en Cloudflare, usará el del grupo actual por defecto
      const chatId = env.TELEGRAM_CHAT_ID || "-1003753713746"; 

      if (!botToken) {
        return new Response(JSON.stringify({ error: "El Token de Telegram no está configurado en el Worker." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 3. Preparar mensajes para Telegram
      const mensajePresentacion = `🎵 *[Petición Web]*\n👤 De: *${name.substring(0, 50)}*`;
      const mensajeComando = `/pedir ${song.substring(0, 150)}`;

      const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

      // 4. Primer mensaje: Presentación
      await fetch(telegramUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: mensajePresentacion,
          parse_mode: "Markdown"
        })
      });

      // 5. Segundo mensaje: El comando puro para el bot de la emisora
      const telegramResponse = await fetch(telegramUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: mensajeComando
        })
      });

      if (!telegramResponse.ok) {
        const errorData = await telegramResponse.text();
        console.error("Error Telegram:", errorData);
        return new Response(JSON.stringify({ error: "Error enviando el mensaje a Telegram desde el Worker." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // 6. Retornar éxito a la página web
      return new Response(JSON.stringify({ status: "success", message: "Petición enviada" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });

    } catch (error) {
      console.error("Worker error:", error.message);
      return new Response(JSON.stringify({ error: "Error interno del servidor." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  }
};
