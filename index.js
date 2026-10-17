require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");

const fs = require("fs");
const http = require("http");

// ==============================
// CONFIGURACIÓN
// ==============================

const TOKEN = process.env.DISCORD_TOKEN;

console.log(
  "🔎 DISCORD_TOKEN:",
  TOKEN ? "DETECTADO ✅" : "NO DETECTADO ❌"
);

if (!TOKEN) {
  console.error("❌ Falta la variable DISCORD_TOKEN.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ==============================
// BASE DE DATOS SIMPLE
// ==============================

const DB_FILE = "./database.json";

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const defaultDB = {
      guilds: {},
      tickets: {},
    };

    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(defaultDB, null, 2)
    );

    return defaultDB;
  }

  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (error) {
    console.error("❌ Error leyendo database.json:", error);

    return {
      guilds: {},
      tickets: {},
    };
  }
}

let db = loadDB();

function saveDB() {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(db, null, 2)
  );
}

function getGuildConfig(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {
      ratingLogs: null,
      transactionLogs: null,
    };

    saveDB();
  }

  return db.guilds[guildId];
}

// ==============================
// UTILIDADES
// ==============================

function ticketId() {
  return Math.floor(1000 + Math.random() * 9000);
}

function cleanName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 15);
}

async function safeReply(interaction, options) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp(options);
    }

    return await interaction.reply(options);
  } catch (error) {
    console.error("Error respondiendo interacción:", error);
  }
}

// ==============================
// COMANDOS SLASH
// ==============================

const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Sistema de tickets")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageChannels
    )
    .addSubcommand(sub =>
      sub
        .setName("panel")
        .setDescription("Envía el panel profesional de tickets")
    ),

  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configura los canales de logs")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )

    .addSubcommand(sub =>
      sub
        .setName("valoracion")
        .setDescription("Configura los logs de valoraciones")
        .addChannelOption(option =>
          option
            .setName("canal")
            .setDescription("Canal de valoraciones")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("transacciones")
        .setDescription("Configura los logs de transacciones")
        .addChannelOption(option =>
          option
            .setName("canal")
            .setDescription("Canal de transacciones")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),
].map(command => command.toJSON());

// ==============================
// READY
// ==============================

client.once("ready", async () => {
  console.log(`✅ Bot de Prueba conectado como ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "🎫 Sistema de Tickets",
      },
    ],
    status: "online",
  });

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      {
        body: commands,
      }
    );

    console.log("✅ Comandos slash registrados.");
  } catch (error) {
    console.error("❌ Error registrando comandos:", error);
  }
});

// ==============================
// INTERACCIONES
// ==============================

client.on("interactionCreate", async interaction => {
  try {

    // ==========================
    // /ticket panel
    // ==========================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "ticket"
    ) {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "panel") {
        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🎫 Centro de Soporte")
          .setDescription(
            [
              "**¿Necesitas ayuda? Estamos para ayudarte.**",
              "",
              "Selecciona en el menú inferior el departamento que corresponda a tu solicitud.",
              "",
              "📩 **Soporte General**",
              "Dudas, problemas o ayuda general.",
              "",
              "💳 **Compras / Transacciones**",
              "Consultas relacionadas con compras o pagos.",
              "",
              "🤝 **Alianzas**",
              "Solicitudes relacionadas con colaboraciones.",
              "",
              "⚠️ No abras tickets sin motivo.",
            ].join("\n")
          )
          .setFooter({
            text: "Bot de Prueba • Sistema de Soporte",
          })
          .setTimestamp();

        const menu = new StringSelectMenuBuilder()
          .setCustomId("ticket_menu")
          .setPlaceholder("Selecciona una categoría...")
          .addOptions(
            {
              label: "Soporte General",
              description: "Necesito ayuda o tengo una duda",
              value: "soporte",
              emoji: "📩",
            },
            {
              label: "Compras / Transacciones",
              description: "Problemas o dudas con una compra",
              value: "compras",
              emoji: "💳",
            },
            {
              label: "Alianzas",
              description: "Contactar por una colaboración",
              value: "alianzas",
              emoji: "🤝",
            }
          );

        const row = new ActionRowBuilder().addComponents(menu);

        await interaction.channel.send({
          embeds: [embed],
          components: [row],
        });

        return interaction.reply({
          content: "✅ Panel de tickets enviado.",
          ephemeral: true,
        });
      }
    }

    // ==========================
    // /logs
    // ==========================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "logs"
    ) {
      const subcommand = interaction.options.getSubcommand();

      const channel =
        interaction.options.getChannel("canal");

      const config = getGuildConfig(interaction.guild.id);

      if (subcommand === "valoracion") {
        config.ratingLogs = channel.id;
        saveDB();

        return interaction.reply({
          content:
            `⭐ Los logs de valoraciones ahora se enviarán a ${channel}.`,
          ephemeral: true,
        });
      }

      if (subcommand === "transacciones") {
        config.transactionLogs = channel.id;
        saveDB();

        return interaction.reply({
          content:
            `💳 Los logs de transacciones ahora se enviarán a ${channel}.`,
          ephemeral: true,
        });
      }
    }

    // ==========================
    // MENÚ DE TICKETS
    // ==========================

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "ticket_menu"
    ) {
      const category = interaction.values[0];

      const existingTicket = Object.values(db.tickets).find(
        ticket =>
          ticket.guildId === interaction.guild.id &&
          ticket.ownerId === interaction.user.id
      );

      if (existingTicket) {
        const existingChannel =
          interaction.guild.channels.cache.get(
            existingTicket.channelId
          );

        if (existingChannel) {
          return interaction.reply({
            content:
              `❌ Ya tienes un ticket abierto: ${existingChannel}`,
            ephemeral: true,
          });
        } else {
          delete db.tickets[existingTicket.channelId];
          saveDB();
        }
      }

      await interaction.deferReply({
        ephemeral: true,
      });

      const number = ticketId();

      const channelName =
        `ticket-${cleanName(interaction.user.username)}-${number}`;

      const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,

        permissionOverwrites: [
          {
            id: interaction.guild.id,
            deny: [
              PermissionFlagsBits.ViewChannel,
            ],
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          },
        ],
      });

      db.tickets[channel.id] = {
        channelId: channel.id,
        guildId: interaction.guild.id,
        ownerId: interaction.user.id,
        claimedBy: null,
        category,
        number,
        createdAt: Date.now(),
      };

      saveDB();

      const categoryNames = {
        soporte: "📩 Soporte General",
        compras: "💳 Compras / Transacciones",
        alianzas: "🤝 Alianzas",
      };

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎫 Ticket #${number}`)
        .setDescription(
          [
            `Bienvenido ${interaction.user}.`,
            "",
            `**Categoría:** ${categoryNames[category]}`,
            "",
            "### 📋 Plantilla",
            "Por favor explica tu solicitud incluyendo:",
            "",
            "• ¿Cuál es el problema o solicitud?",
            "• Información importante que debamos conocer.",
            "• Capturas o pruebas, si son necesarias.",
            "",
            "Un miembro del equipo reclamará tu ticket en cuanto esté disponible.",
          ].join("\n")
        )
        .setFooter({
          text: "Bot de Prueba • Soporte",
        })
        .setTimestamp();

      const claimButton = new ButtonBuilder()
        .setCustomId("claim_ticket")
        .setLabel("Reclamar ticket")
        .setEmoji("🙋")
        .setStyle(ButtonStyle.Primary);

      const closeButton = new ButtonBuilder()
        .setCustomId("close_ticket")
        .setLabel("Cerrar ticket")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(
        claimButton,
        closeButton
      );

      await channel.send({
        content: `${interaction.user}`,
        embeds: [embed],
        components: [row],
      });

      return interaction.editReply({
        content: `✅ Ticket creado correctamente: ${channel}`,
      });
    }

    // ==========================
    // RECLAMAR TICKET
    // ==========================

    if (
      interaction.isButton() &&
      interaction.customId === "claim_ticket"
    ) {
      const ticket = db.tickets[interaction.channel.id];

      if (!ticket) {
        return interaction.reply({
          content: "❌ Este canal no está registrado como ticket.",
          ephemeral: true,
        });
      }

      if (
        !interaction.member.permissions.has(
          PermissionFlagsBits.ManageMessages
        )
      ) {
        return interaction.reply({
          content:
            "❌ Solo el equipo de soporte puede reclamar tickets.",
          ephemeral: true,
        });
      }

      if (ticket.claimedBy) {
        return interaction.reply({
          content:
            `❌ Este ticket ya fue reclamado por <@${ticket.claimedBy}>.`,
          ephemeral: true,
        });
      }

      ticket.claimedBy = interaction.user.id;
      saveDB();

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("🙋 Ticket reclamado")
        .setDescription(
          `${interaction.user} se encargará de este ticket.`
        )
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
      });
    }

    // ==========================
    // CERRAR TICKET
    // ==========================

    if (
      interaction.isButton() &&
      interaction.customId === "close_ticket"
    ) {
      const ticket = db.tickets[interaction.channel.id];

      if (!ticket) {
        return interaction.reply({
          content: "❌ Este ticket no está registrado.",
          ephemeral: true,
        });
      }

      if (!ticket.claimedBy) {
        return interaction.reply({
          content:
            "❌ El ticket debe ser reclamado antes de poder cerrarlo.",
          ephemeral: true,
        });
      }

      if (ticket.claimedBy !== interaction.user.id) {
        return interaction.reply({
          content:
            `🔒 Solo <@${ticket.claimedBy}>, quien reclamó este ticket, puede cerrarlo.`,
          ephemeral: true,
        });
      }

      const owner =
        await interaction.guild.members
          .fetch(ticket.ownerId)
          .catch(() => null);

      if (!owner) {
        delete db.tickets[interaction.channel.id];
        saveDB();

        await interaction.reply({
          content:
            "⚠️ No pude encontrar al usuario. Cerrando ticket...",
        });

        setTimeout(() => {
          interaction.channel.delete().catch(() => {});
        }, 3000);

        return;
      }

      // Quitamos al usuario del ticket antes de pedir valoración.
      await interaction.channel.permissionOverwrites
        .edit(ticket.ownerId, {
          ViewChannel: false,
        })
        .catch(() => {});

      const ratingEmbed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle("⭐ Valora nuestra atención")
        .setDescription(
          [
            `Tu ticket **#${ticket.number}** ha sido atendido.`,
            "",
            `Atendido por: <@${ticket.claimedBy}>`,
            "",
            "**¿Cómo valorarías la atención recibida?**",
            "",
            "Selecciona entre **1 y 5 estrellas**.",
          ].join("\n")
        )
        .setFooter({
          text: "Tu valoración nos ayuda a mejorar",
        });

      const ratingRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            `rating_${interaction.channel.id}_1`
          )
          .setLabel("1")
          .setEmoji("⭐")
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId(
            `rating_${interaction.channel.id}_2`
          )
          .setLabel("2")
          .setEmoji("⭐")
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId(
            `rating_${interaction.channel.id}_3`
          )
          .setLabel("3")
          .setEmoji("⭐")
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId(
            `rating_${interaction.channel.id}_4`
          )
          .setLabel("4")
          .setEmoji("⭐")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId(
            `rating_${interaction.channel.id}_5`
          )
          .setLabel("5")
          .setEmoji("⭐")
          .setStyle(ButtonStyle.Success)
      );

      try {
        await owner.send({
          embeds: [ratingEmbed],
          components: [ratingRow],
        });

        await interaction.reply({
          content:
            `🔒 Ticket cerrado por ${interaction.user}.\n⭐ Se envió una solicitud de valoración a ${owner.user.username} por MD.`,
        });
      } catch {
        await interaction.reply({
          content:
            "🔒 Ticket cerrado. No pude enviar la valoración por MD porque el usuario tiene los mensajes privados desactivados.",
        });
      }

      // Logs de transacciones/cierre
      const config = getGuildConfig(interaction.guild.id);

      if (config.transactionLogs) {
        const logChannel =
          interaction.guild.channels.cache.get(
            config.transactionLogs
          );

        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("🔒 Ticket cerrado")
            .addFields(
              {
                name: "Ticket",
                value: `#${ticket.number}`,
                inline: true,
              },
              {
                name: "Usuario",
                value: `<@${ticket.ownerId}>`,
                inline: true,
              },
              {
                name: "Atendido por",
                value: `<@${ticket.claimedBy}>`,
                inline: true,
              },
              {
                name: "Categoría",
                value: ticket.category,
                inline: true,
              }
            )
            .setTimestamp();

          await logChannel.send({
            embeds: [logEmbed],
          }).catch(() => {});
        }
      }

      // Guardamos el ticket temporalmente para recibir valoración.
      ticket.closed = true;
      saveDB();

      setTimeout(async () => {
        const currentTicket =
          db.tickets[interaction.channel.id];

        if (currentTicket) {
          delete db.tickets[interaction.channel.id];
          saveDB();
        }

        await interaction.channel
          .delete("Ticket cerrado")
          .catch(() => {});
      }, 10000);

      return;
    }

    // ==========================
    // VALORACIÓN
    // ==========================

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("rating_")
    ) {
      const parts = interaction.customId.split("_");

      const channelId = parts[1];
      const stars = Number(parts[2]);

      const ticket = db.tickets[channelId];

      if (!ticket) {
        return interaction.reply({
          content:
            "❌ Esta solicitud de valoración ya expiró.",
          ephemeral: true,
        });
      }

      if (interaction.user.id !== ticket.ownerId) {
        return interaction.reply({
          content:
            "❌ Esta valoración no te pertenece.",
          ephemeral: true,
        });
      }

      const guild =
        client.guilds.cache.get(ticket.guildId);

      if (!guild) {
        return interaction.reply({
          content:
            "❌ No pude encontrar el servidor.",
          ephemeral: true,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(
          `rating_modal_${channelId}_${stars}`
        )
        .setTitle(`${stars}/5 estrellas`);

      const commentInput = new TextInputBuilder()
        .setCustomId("comment")
        .setLabel("¿Qué te pareció la atención?")
        .setPlaceholder(
          "Escribe un comentario sobre tu experiencia..."
        )
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500);

      const row =
        new ActionRowBuilder().addComponents(commentInput);

      modal.addComponents(row);

      return interaction.showModal(modal);
    }

    // ==========================
    // MODAL DE VALORACIÓN
    // ==========================

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("rating_modal_")
    ) {
      const parts = interaction.customId.split("_");

      const channelId = parts[2];
      const stars = Number(parts[3]);

      const ticket = db.tickets[channelId];

      if (!ticket) {
        return interaction.reply({
          content:
            "❌ Esta valoración ya expiró.",
          ephemeral: true,
        });
      }

      if (interaction.user.id !== ticket.ownerId) {
        return interaction.reply({
          content:
            "❌ Esta valoración no te pertenece.",
          ephemeral: true,
        });
      }

      const comment =
        interaction.fields.getTextInputValue("comment") ||
        "Sin comentario.";

      const guild =
        client.guilds.cache.get(ticket.guildId);

      if (!guild) {
        return interaction.reply({
          content:
            "❌ No pude encontrar el servidor.",
          ephemeral: true,
        });
      }

      const config = getGuildConfig(guild.id);

      const ratingChannel =
        config.ratingLogs
          ? guild.channels.cache.get(config.ratingLogs)
          : null;

      const starsText =
        "⭐".repeat(stars) +
        "☆".repeat(5 - stars);

      if (ratingChannel) {
        const ratingEmbed = new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle("⭐ Nueva valoración")
          .setDescription(
            `**${starsText} — ${stars}/5**`
          )
          .addFields(
            {
              name: "👤 Usuario",
              value: `<@${ticket.ownerId}>`,
              inline: true,
            },
            {
              name: "🛡️ Staff",
              value: `<@${ticket.claimedBy}>`,
              inline: true,
            },
            {
              name: "🎫 Ticket",
              value: `#${ticket.number}`,
              inline: true,
            },
            {
              name: "💬 Comentario",
              value: comment,
            }
          )
          .setFooter({
            text: "Bot de Prueba • Valoraciones",
          })
          .setTimestamp();

        await ratingChannel.send({
          embeds: [ratingEmbed],
        }).catch(() => {});
      }

      delete db.tickets[channelId];
      saveDB();

      return interaction.reply({
        content:
          `✅ ¡Gracias por tu valoración!\n\n${starsText} **${stars}/5**`,
      });
    }
  } catch (error) {
    console.error("❌ Error en interactionCreate:", error);

    await safeReply(interaction, {
      content:
        "❌ Ocurrió un error procesando esta acción.",
      ephemeral: true,
    });
  }
});

// ==============================
// SERVIDOR HTTP PARA HOSTINGS
// ==============================

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain",
    });

    res.end("Bot de Prueba está online.");
  })
  .listen(PORT, () => {
    console.log(`🌐 Servidor HTTP activo en puerto ${PORT}`);
  });

// ==============================
// ERRORES
// ==============================

process.on("unhandledRejection", error => {
  console.error("Unhandled Rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught Exception:", error);
});

// ==============================
// LOGIN
// ==============================

client.login(TOKEN);
