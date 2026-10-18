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
  AttachmentBuilder,
} = require("discord.js");

const fs = require("fs");
const http = require("http");

// ======================================================
// CONFIGURACIÓN
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const DB_FILE = "./database.json";

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

// ======================================================
// BASE DE DATOS JSON
// ======================================================

function defaultDB() {
  return {
    guilds: {},
    tickets: {},
  };
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const data = defaultDB();
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    return data;
  }

  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

    if (!data.guilds) data.guilds = {};
    if (!data.tickets) data.tickets = {};

    return data;
  } catch (error) {
    console.error("❌ Error leyendo database.json:", error);
    return defaultDB();
  }
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error("❌ Error guardando database.json:", error);
  }
}

function getGuildConfig(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {
      staffRole: null,
      ticketCategory: null,
      ratingLogs: null,
      transactionLogs: null,
      blacklist: {},
      stats: {
        created: 0,
        closed: 0,
        ratings: [],
        staff: {},
      },
    };

    saveDB();
  }

  const config = db.guilds[guildId];

  if (!config.blacklist) config.blacklist = {};

  if (!config.stats) {
    config.stats = {
      created: 0,
      closed: 0,
      ratings: [],
      staff: {},
    };
  }

  if (!config.stats.ratings) config.stats.ratings = [];
  if (!config.stats.staff) config.stats.staff = {};

  return config;
}

// ======================================================
// CATEGORÍAS
// ======================================================

const CATEGORY_INFO = {
  soporte: {
    emoji: "📩",
    name: "Soporte General",
    question: "¿En qué podemos ayudarte?",
    placeholder:
      "Describe detalladamente tu problema, duda o solicitud...",
  },

  compras: {
    emoji: "💳",
    name: "Compras / Transacciones",
    question: "¿Qué ocurrió con tu compra o transacción?",
    placeholder:
      "Describe el problema e incluye toda la información necesaria...",
  },

  alianzas: {
    emoji: "🤝",
    name: "Alianzas",
    question: "¿Cuál es tu propuesta?",
    placeholder:
      "Cuéntanos sobre tu servidor, proyecto o propuesta...",
  },
};

// ======================================================
// UTILIDADES
// ======================================================

function isRealAdmin(interaction) {
  return interaction.member.permissions.has(
    PermissionFlagsBits.Administrator
  );
}

function hasStaffRole(member, guildId) {
  const config = getGuildConfig(guildId);

  if (!config.staffRole) return false;

  return member.roles.cache.has(config.staffRole);
}

function isTicketStaff(interaction) {
  return (
    isRealAdmin(interaction) ||
    hasStaffRole(interaction.member, interaction.guild.id)
  );
}

function cleanName(text) {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "ticket"
  );
}

async function safeReply(interaction, options) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp(options);
    }

    return await interaction.reply(options);
  } catch (error) {
    console.error("❌ Error respondiendo:", error);
  }
}

function categoryInfo(category) {
  return (
    CATEGORY_INFO[category] || {
      emoji: "🎫",
      name: "Ticket",
      question: "Solicitud",
    }
  );
}

function getTicket(channelId) {
  return db.tickets[channelId] || null;
}

function statusName(ticket) {
  switch (ticket.status) {
    case "waiting":
      return "🟡 Esperando atención";

    case "claimed":
      return "🟢 En atención";

    case "rating":
      return "⭐ Esperando valoración";

    case "reason":
      return "🟠 Pendiente del motivo de cierre";

    case "confirm":
      return "🔴 Pendiente de cierre";

    case "closing":
      return "🔴 Finalizando";

    default:
      return "⚪ Desconocido";
  }
}

function ensureStaffStats(guildId, userId) {
  const config = getGuildConfig(guildId);

  if (!config.stats.staff[userId]) {
    config.stats.staff[userId] = {
      claimed: 0,
      closed: 0,
      ratings: [],
    };
  }

  return config.stats.staff[userId];
}

// ======================================================
// TRANSCRIPT
// ======================================================

async function createTranscript(channel, ticket) {
  try {
    let messagesArray = [];
    let before;

    while (messagesArray.length < 1000) {
      const options = { limit: 100 };

      if (before) options.before = before;

      const messages = await channel.messages.fetch(options);

      if (!messages.size) break;

      messagesArray.push(...messages.values());

      before = messages.last().id;

      if (messages.size < 100) break;
    }

    messagesArray.sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    const info = categoryInfo(ticket.category);

    const lines = [
      "======================================================",
      "                 TRANSCRIPCIÓN DEL TICKET",
      "======================================================",
      "",
      `Servidor: ${channel.guild.name}`,
      `Canal: #${channel.name}`,
      `Usuario: ${ticket.ownerId}`,
      `Categoría: ${info.name}`,
      `Solicitud inicial: ${ticket.reason}`,
      `Staff: ${ticket.claimedBy || "Sin asignar"}`,
      `Estado: ${statusName(ticket)}`,
      `Creado: ${new Date(ticket.createdAt).toLocaleString()}`,
      `Motivo de cierre: ${ticket.closeReason || "Sin especificar"}`,
      `Valoración: ${
        ticket.rating ? `${ticket.rating}/5` : "Sin valoración"
      }`,
      `Comentario: ${ticket.ratingComment || "Sin comentario"}`,
      "",
      "======================================================",
      "                       MENSAJES",
      "======================================================",
      "",
    ];

    for (const message of messagesArray) {
      const date = new Date(
        message.createdTimestamp
      ).toLocaleString();

      const content =
        message.content && message.content.trim()
          ? message.content
          : "[Sin contenido de texto]";

      lines.push(
        `[${date}] ${message.author.tag} (${message.author.id})`
      );

      lines.push(content);

      for (const attachment of message.attachments.values()) {
        lines.push(`📎 ${attachment.name}: ${attachment.url}`);
      }

      if (message.embeds.length) {
        lines.push(
          `[El mensaje contiene ${message.embeds.length} embed(s)]`
        );
      }

      lines.push("");
    }

    return Buffer.from(lines.join("\n"), "utf8");
  } catch (error) {
    console.error("❌ Error generando transcript:", error);

    return Buffer.from(
      "No fue posible generar correctamente la transcripción.",
      "utf8"
    );
  }
}

// ======================================================
// COMANDOS
// ======================================================

const commands = [
  // /ticket
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Sistema profesional de tickets")
    .addSubcommand(sub =>
      sub
        .setName("panel")
        .setDescription("Publica el panel de tickets")
    )
    .addSubcommand(sub =>
      sub
        .setName("info")
        .setDescription("Muestra información del ticket actual")
    ),

  // /logs
  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configura los registros del sistema")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addSubcommand(sub =>
      sub
        .setName("valoracion")
        .setDescription("Configura el canal de valoraciones")
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
        .setDescription("Configura el canal de cierres/transcripts")
        .addChannelOption(option =>
          option
            .setName("canal")
            .setDescription("Canal de registros")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),

  // /admin
  new SlashCommandBuilder()
    .setName("admin")
    .setDescription("Administración del sistema de tickets")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addSubcommand(sub =>
      sub
        .setName("rol")
        .setDescription("Configura el rol del equipo de soporte")
        .addRoleOption(option =>
          option
            .setName("rol")
            .setDescription("Rol de soporte")
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("quitar")
        .setDescription("Elimina el rol de soporte configurado")
    )

    .addSubcommand(sub =>
      sub
        .setName("ver")
        .setDescription("Muestra la configuración administrativa")
    ),

  // /config
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configuración avanzada de tickets")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addSubcommand(sub =>
      sub
        .setName("categoria")
        .setDescription("Categoría donde se crearán los tickets")
        .addChannelOption(option =>
          option
            .setName("categoria")
            .setDescription("Categoría de Discord")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    ),

  // /rename
  new SlashCommandBuilder()
    .setName("rename")
    .setDescription("Renombra el ticket actual")
    .addStringOption(option =>
      option
        .setName("nombre")
        .setDescription("Nuevo nombre")
        .setRequired(true)
        .setMaxLength(80)
    ),

  // /user
  new SlashCommandBuilder()
    .setName("user")
    .setDescription("Administra usuarios del ticket")

    .addSubcommand(sub =>
      sub
        .setName("invite")
        .setDescription("Añade un usuario al ticket")
        .addUserOption(option =>
          option
            .setName("usuario")
            .setDescription("Usuario")
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Retira un usuario del ticket")
        .addUserOption(option =>
          option
            .setName("usuario")
            .setDescription("Usuario")
            .setRequired(true)
        )
    ),

  // /transfer
  new SlashCommandBuilder()
    .setName("transfer")
    .setDescription("Transfiere el ticket a otro miembro del staff")
    .addUserOption(option =>
      option
        .setName("usuario")
        .setDescription("Nuevo responsable")
        .setRequired(true)
    ),

  // /release
  new SlashCommandBuilder()
    .setName("release")
    .setDescription("Libera el ticket para que otro staff pueda reclamarlo"),

  // /notice
  new SlashCommandBuilder()
    .setName("notice")
    .setDescription("Publica un aviso del equipo en el ticket")
    .addStringOption(option =>
      option
        .setName("mensaje")
        .setDescription("Contenido del aviso")
        .setRequired(true)
        .setMaxLength(1500)
    ),

  // /stats
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Muestra estadísticas del sistema de tickets"),

  // /blacklist
  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription("Administra la lista negra")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Añade un usuario a la blacklist")
        .addUserOption(option =>
          option
            .setName("usuario")
            .setDescription("Usuario")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("motivo")
            .setDescription("Motivo")
            .setRequired(true)
            .setMaxLength(500)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription("Retira un usuario de la blacklist")
        .addUserOption(option =>
          option
            .setName("usuario")
            .setDescription("Usuario")
            .setRequired(true)
        )
    ),
].map(command => command.toJSON());

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {
  console.log(`✅ Conectado como ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "🎫 Sistema profesional de soporte",
      },
    ],
    status: "online",
  });

  try {
    const rest = new REST({ version: "10" }).setToken(TOKEN);

    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands,
    });

    console.log("✅ Comandos slash registrados.");
  } catch (error) {
    console.error("❌ Error registrando comandos:", error);
  }
});

// ======================================================
// INTERACCIONES
// ======================================================

client.on("interactionCreate", async interaction => {
  try {
    // ==================================================
    // /ticket panel + /ticket info
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "ticket"
    ) {
      const sub = interaction.options.getSubcommand();

      // PANEL = SOLO ADMIN REAL
      if (sub === "panel") {
        if (!isRealAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo un administrador del servidor puede publicar el panel.",
            ephemeral: true,
          });
        }

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setAuthor({
            name: `${interaction.guild.name} • Soporte`,
            iconURL: interaction.guild.iconURL() || undefined,
          })
          .setTitle("🎫 Centro de Soporte")
          .setDescription(
            [
              "### ¿Cómo podemos ayudarte?",
              "Bienvenido a nuestro centro de atención.",
              "",
              "Selecciona el departamento que mejor corresponda con tu solicitud. Después podrás explicarnos detalladamente lo ocurrido.",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "📩 **Soporte General**",
              "> Dudas, problemas, reportes y asistencia.",
              "",
              "💳 **Compras / Transacciones**",
              "> Consultas relacionadas con compras, pagos o transacciones.",
              "",
              "🤝 **Alianzas**",
              "> Propuestas de colaboración y alianzas.",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "### 📌 Antes de continuar",
              "• Describe claramente tu solicitud.",
              "• Adjunta capturas o pruebas cuando sea necesario.",
              "• No abras varios tickets por el mismo motivo.",
              "• El uso indebido del sistema puede ser restringido.",
              "",
              "**Selecciona una categoría para comenzar.**",
            ].join("\n")
          )
          .setThumbnail(interaction.guild.iconURL() || null)
          .setFooter({
            text: "Sistema de Soporte • Atención organizada y segura",
          })
          .setTimestamp();

        const menu = new StringSelectMenuBuilder()
          .setCustomId("ticket_menu")
          .setPlaceholder("📨 Selecciona un departamento...")
          .addOptions(
            {
              label: "Soporte General",
              description: "Dudas, problemas y asistencia",
              value: "soporte",
              emoji: "📩",
            },
            {
              label: "Compras / Transacciones",
              description: "Compras, pagos y transacciones",
              value: "compras",
              emoji: "💳",
            },
            {
              label: "Alianzas",
              description: "Propuestas y colaboraciones",
              value: "alianzas",
              emoji: "🤝",
            }
          );

        await interaction.channel.send({
          embeds: [embed],
          components: [
            new ActionRowBuilder().addComponents(menu),
          ],
        });

        return interaction.reply({
          content: "✅ Panel de soporte publicado correctamente.",
          ephemeral: true,
        });
      }

      // INFO = STAFF
      if (sub === "info") {
        if (!isTicketStaff(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo el equipo de soporte puede consultar esta información.",
            ephemeral: true,
          });
        }

        const ticket = getTicket(interaction.channel.id);

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Este canal no está registrado como un ticket.",
            ephemeral: true,
          });
        }

        const info = categoryInfo(ticket.category);

        const embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📋 Información del Ticket")
          .addFields(
            {
              name: "👤 Propietario",
              value: `<@${ticket.ownerId}>`,
              inline: true,
            },
            {
              name: "🛡️ Responsable",
              value: ticket.claimedBy
                ? `<@${ticket.claimedBy}>`
                : "Sin asignar",
              inline: true,
            },
            {
              name: "📂 Categoría",
              value: `${info.emoji} ${info.name}`,
              inline: true,
            },
            {
              name: "📊 Estado",
              value: statusName(ticket),
              inline: true,
            },
            {
              name: "📝 Solicitud inicial",
              value: ticket.reason,
            }
          )
          .setTimestamp();

        return interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      }
    }

    // ==================================================
    // /ADMIN
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "admin"
    ) {
      if (!isRealAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ Este comando requiere el permiso **Administrador** de Discord.",
          ephemeral: true,
        });
      }

      const sub = interaction.options.getSubcommand();
      const config = getGuildConfig(interaction.guild.id);

      if (sub === "rol") {
        const role = interaction.options.getRole("rol");

        config.staffRole = role.id;
        saveDB();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("🛡️ Equipo de Soporte Configurado")
              .setDescription(
                [
                  `${role} ahora es el **rol oficial de soporte**.`,
                  "",
                  "### Este rol podrá",
                  "• Ver los tickets creados.",
                  "• Reclamar tickets disponibles.",
                  "• Renombrar tickets.",
                  "• Añadir o retirar usuarios.",
                  "• Transferir o liberar tickets.",
                  "• Gestionar el proceso de cierre.",
                  "",
                  "### No podrá",
                  "• Publicar el panel.",
                  "• Configurar los logs.",
                  "• Cambiar el rol administrativo.",
                  "• Administrar la blacklist.",
                  "",
                  "Los usuarios con permiso **Administrador** mantienen acceso total.",
                ].join("\n")
              )
              .setTimestamp(),
          ],
        });
      }

      if (sub === "quitar") {
        config.staffRole = null;
        saveDB();

        return interaction.reply({
          content:
            "✅ El rol de soporte configurado ha sido eliminado.",
          ephemeral: true,
        });
      }

      if (sub === "ver") {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("⚙️ Configuración del Sistema")
              .addFields(
                {
                  name: "🛡️ Rol de soporte",
                  value: config.staffRole
                    ? `<@&${config.staffRole}>`
                    : "No configurado",
                },
                {
                  name: "📁 Categoría",
                  value: config.ticketCategory
                    ? `<#${config.ticketCategory}>`
                    : "No configurada",
                },
                {
                  name: "⭐ Logs de valoraciones",
                  value: config.ratingLogs
                    ? `<#${config.ratingLogs}>`
                    : "No configurados",
                },
                {
                  name: "📜 Logs / Transcripts",
                  value: config.transactionLogs
                    ? `<#${config.transactionLogs}>`
                    : "No configurados",
                }
              )
              .setTimestamp(),
          ],
          ephemeral: true,
        });
      }
    }

    // ==================================================
    // /CONFIG CATEGORIA
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "config"
    ) {
      if (!isRealAdmin(interaction)) {
        return interaction.reply({
          content: "❌ Solo administradores.",
          ephemeral: true,
        });
      }

      const category =
        interaction.options.getChannel("categoria");

      const config = getGuildConfig(interaction.guild.id);

      config.ticketCategory = category.id;
      saveDB();

      return interaction.reply({
        content:
          `✅ Los nuevos tickets se crearán dentro de **${category.name}**.`,
        ephemeral: true,
      });
    }

    // ==================================================
    // /LOGS
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "logs"
    ) {
      if (!isRealAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ Solo los administradores pueden configurar los logs.",
          ephemeral: true,
        });
      }

      const sub = interaction.options.getSubcommand();
      const channel = interaction.options.getChannel("canal");
      const config = getGuildConfig(interaction.guild.id);

      if (sub === "valoracion") {
        config.ratingLogs = channel.id;
      }

      if (sub === "transacciones") {
        config.transactionLogs = channel.id;
      }

      saveDB();

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("✅ Configuración actualizada")
            .setDescription(
              sub === "valoracion"
                ? `Las nuevas valoraciones serán publicadas en ${channel}.`
                : `Los cierres y transcripts serán enviados a ${channel}.`
            )
            .setTimestamp(),
        ],
        ephemeral: true,
      });
    }

    // ==================================================
    // BLACKLIST
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "blacklist"
    ) {
      if (!isRealAdmin(interaction)) {
        return interaction.reply({
          content: "❌ Solo administradores.",
          ephemeral: true,
        });
      }

      const config = getGuildConfig(interaction.guild.id);
      const sub = interaction.options.getSubcommand();
      const user = interaction.options.getUser("usuario");

      if (sub === "add") {
        const reason =
          interaction.options.getString("motivo");

        config.blacklist[user.id] = {
          reason,
          addedBy: interaction.user.id,
          addedAt: Date.now(),
        };

        saveDB();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("🚫 Usuario restringido")
              .setDescription(
                `${user} ya no podrá crear tickets en este servidor.`
              )
              .addFields({
                name: "Motivo",
                value: reason,
              })
              .setTimestamp(),
          ],
          ephemeral: true,
        });
      }

      if (sub === "remove") {
        delete config.blacklist[user.id];
        saveDB();

        return interaction.reply({
          content:
            `✅ ${user} ha sido retirado de la lista negra.`,
          ephemeral: true,
        });
      }
    }

    // ==================================================
    // MENÚ → FORMULARIO
    // ==================================================

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === "ticket_menu"
    ) {
      const config = getGuildConfig(interaction.guild.id);

      const blacklisted =
        config.blacklist[interaction.user.id];

      if (blacklisted) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("🚫 Acceso al soporte restringido")
              .setDescription(
                "Actualmente no puedes crear tickets en este servidor."
              )
              .addFields({
                name: "Motivo",
                value: blacklisted.reason,
              }),
          ],
          ephemeral: true,
        });
      }

      const existing = Object.values(db.tickets).find(
        t =>
          t.guildId === interaction.guild.id &&
          t.ownerId === interaction.user.id
      );

      if (existing) {
        const existingChannel =
          interaction.guild.channels.cache.get(
            existing.channelId
          );

        if (existingChannel) {
          return interaction.reply({
            content:
              `❌ Ya tienes una solicitud activa: ${existingChannel}`,
            ephemeral: true,
          });
        }

        delete db.tickets[existing.channelId];
        saveDB();
      }

      const category = interaction.values[0];
      const info = categoryInfo(category);

      const modal = new ModalBuilder()
        .setCustomId(`create_ticket_${category}`)
        .setTitle(`${info.emoji} ${info.name}`);

      const reason = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel(info.question)
        .setPlaceholder(info.placeholder)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMinLength(5)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(reason)
      );

      return interaction.showModal(modal);
    }

    // ==================================================
    // CREAR TICKET
    // ==================================================

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("create_ticket_")
    ) {
      const category =
        interaction.customId.replace("create_ticket_", "");

      const info = categoryInfo(category);
      const reason =
        interaction.fields.getTextInputValue("reason");

      const config = getGuildConfig(interaction.guild.id);

      await interaction.deferReply({
        ephemeral: true,
      });

      const username = cleanName(interaction.user.username);

      let channelName = `ticket-${username}`;

      if (
        interaction.guild.channels.cache.some(
          c => c.name === channelName
        )
      ) {
        channelName =
          `ticket-${username}-${Date.now()
            .toString()
            .slice(-4)}`;
      }

      const overwrites = [
        {
          id: interaction.guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
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
      ];

      if (config.staffRole) {
        overwrites.push({
          id: config.staffRole,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
            PermissionFlagsBits.EmbedLinks,
          ],
        });
      }

      const channel =
        await interaction.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: config.ticketCategory || undefined,
          permissionOverwrites: overwrites,
        });

      db.tickets[channel.id] = {
        channelId: channel.id,
        guildId: interaction.guild.id,
        ownerId: interaction.user.id,
        category,
        reason,
        claimedBy: null,
        status: "waiting",
        createdAt: Date.now(),

        rating: null,
        ratingComment: null,

        closeReason: null,

        invitedUsers: [],
      };

      config.stats.created++;
      saveDB();

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({
          name: "Nueva solicitud de soporte",
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTitle(`${info.emoji} ${info.name}`)
        .setDescription(
          [
            `Bienvenido ${interaction.user}.`,
            "",
            "Tu solicitud ha sido registrada correctamente y ya es visible para nuestro equipo.",
            "",
            "━━━━━━━━━━━━━━━━━━━━",
            "",
            `### ${info.emoji} Categoría`,
            `**${info.name}**`,
            "",
            `### 📝 ${info.question}`,
            reason,
            "",
            "━━━━━━━━━━━━━━━━━━━━",
            "",
            "### 🟡 Estado",
            "**Esperando a un miembro del equipo**",
            "",
            "Mientras esperas puedes proporcionar información adicional, capturas o archivos relacionados.",
          ].join("\n")
        )
        .addFields({
          name: "👤 Solicitante",
          value:
            `${interaction.user}\n\`${interaction.user.id}\``,
          inline: true,
        })
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({
          text: `${interaction.guild.name} • Centro de Soporte`,
          iconURL: interaction.guild.iconURL() || undefined,
        })
        .setTimestamp();

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("claim_ticket")
          .setLabel("Reclamar")
          .setEmoji("🙋")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("Cerrar ticket")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Danger)
      );

      await channel.send({
        content: `${interaction.user}`,
        embeds: [embed],
        components: [buttons],
      });

      return interaction.editReply({
        content:
          `✅ Tu solicitud ha sido creada correctamente: ${channel}`,
      });
    }

    // ==================================================
    // RECLAMAR
    // ==================================================

    if (
      interaction.isButton() &&
      interaction.customId === "claim_ticket"
    ) {
      const ticket = getTicket(interaction.channel.id);

      if (!ticket) {
        return interaction.reply({
          content: "❌ Este ticket ya no está registrado.",
          ephemeral: true,
        });
      }

      if (!isTicketStaff(interaction)) {
        return interaction.reply({
          content:
            "❌ Esta acción está reservada para el equipo de soporte.",
          ephemeral: true,
        });
      }

      if (ticket.claimedBy) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfee75c)
              .setTitle("⚠️ Ticket ya asignado")
              .setDescription(
                [
                  "Esta solicitud ya está siendo atendida.",
                  "",
                  `🛡️ **Responsable:** <@${ticket.claimedBy}>`,
                  "",
                  "Si es necesario cambiar al responsable, utiliza el comando de transferencia.",
                ].join("\n")
              ),
          ],
          ephemeral: true,
        });
      }

      ticket.claimedBy = interaction.user.id;
      ticket.status = "claimed";

      const staffStats = ensureStaffStats(
        interaction.guild.id,
        interaction.user.id
      );

      staffStats.claimed++;

      saveDB();

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setAuthor({
          name: "Equipo de Soporte",
          iconURL: interaction.user.displayAvatarURL(),
        })
        .setTitle("🙋 Solicitud asignada")
        .setDescription(
          [
            `${interaction.user} ha reclamado esta solicitud.`,
            "",
            "### 🟢 Estado",
            "**En atención**",
            "",
            `👤 **Usuario:** <@${ticket.ownerId}>`,
            `🛡️ **Responsable:** ${interaction.user}`,
            "",
            "A partir de este momento, el miembro indicado será responsable de gestionar y finalizar esta solicitud.",
          ].join("\n")
        )
        .setFooter({
          text: "Centro de Soporte • Ticket en atención",
        })
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
      });
    }

    // ==================================================
    // /RENAME
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "rename"
    ) {
      if (!isTicketStaff(interaction)) {
        return interaction.reply({
          content: "❌ Solo el equipo de soporte.",
          ephemeral: true,
        });
      }

      const ticket = getTicket(interaction.channel.id);

      if (!ticket) {
        return interaction.reply({
          content:
            "❌ Este comando solo funciona dentro de tickets.",
          ephemeral: true,
        });
      }

      const name = cleanName(
        interaction.options.getString("nombre")
      );

      await interaction.channel.setName(name);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("✏️ Ticket renombrado")
            .setDescription(
              `${interaction.user} cambió el nombre de este ticket a **#${name}**.`
            )
            .setTimestamp(),
        ],
      });
    }

    // ==================================================
    // /USER
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "user"
    ) {
      if (!isTicketStaff(interaction)) {
        return interaction.reply({
          content: "❌ Solo el equipo de soporte.",
          ephemeral: true,
        });
      }

      const ticket = getTicket(interaction.channel.id);

      if (!ticket) {
        return interaction.reply({
          content:
            "❌ Este comando solo funciona dentro de tickets.",
          ephemeral: true,
        });
      }

      const sub = interaction.options.getSubcommand();
      const user = interaction.options.getUser("usuario");

      if (sub === "invite") {
        await interaction.channel.permissionOverwrites.edit(
          user.id,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
            EmbedLinks: true,
          }
        );

        if (!ticket.invitedUsers.includes(user.id)) {
          ticket.invitedUsers.push(user.id);
        }

        saveDB();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("👤 Usuario añadido")
              .setDescription(
                `${user} ha sido invitado a esta solicitud por ${interaction.user}.`
              )
              .setTimestamp(),
          ],
        });
      }

      if (sub === "remove") {
        if (user.id === ticket.ownerId) {
          return interaction.reply({
            content:
              "❌ No puedes retirar al propietario original.",
            ephemeral: true,
          });
        }

        await interaction.channel.permissionOverwrites.edit(
          user.id,
          {
            ViewChannel: false,
            SendMessages: false,
          }
        );

        ticket.invitedUsers =
          ticket.invitedUsers.filter(id => id !== user.id);

        saveDB();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("👤 Usuario retirado")
              .setDescription(
                `${user} ya no tiene acceso a este ticket.`
              )
              .setTimestamp(),
          ],
        });
      }
    }

    // ==================================================
    // /TRANSFER
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "transfer"
    ) {
      if (!isTicketStaff(interaction)) {
        return interaction.reply({
          content: "❌ Solo el equipo de soporte.",
          ephemeral: true,
        });
      }

      const ticket = getTicket(interaction.channel.id);

      if (!ticket) {
        return interaction.reply({
          content: "❌ No estás dentro de un ticket.",
          ephemeral: true,
        });
      }

      if (
        ticket.claimedBy !== interaction.user.id &&
        !isRealAdmin(interaction)
      ) {
        return interaction.reply({
          content:
            "❌ Solo el responsable actual o un administrador puede transferir este ticket.",
          ephemeral: true,
        });
      }

      const target = interaction.options.getUser("usuario");

      const member =
        await interaction.guild.members.fetch(target.id).catch(
          () => null
        );

      if (
        !member ||
        (!member.permissions.has(
          PermissionFlagsBits.Administrator
        ) &&
          !hasStaffRole(member, interaction.guild.id))
      ) {
        return interaction.reply({
          content:
            "❌ El usuario seleccionado no pertenece al equipo de soporte.",
          ephemeral: true,
        });
      }

      const oldStaff = ticket.claimedBy;

      ticket.claimedBy = target.id;
      ticket.status = "claimed";

      saveDB();

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🔄 Ticket transferido")
            .setDescription(
              [
                "La responsabilidad de esta solicitud ha sido transferida.",
                "",
                `🛡️ **Anterior:** ${
                  oldStaff ? `<@${oldStaff}>` : "Sin asignar"
                }`,
                `🛡️ **Nuevo responsable:** ${target}`,
                `👤 **Transferido por:** ${interaction.user}`,
              ].join("\n")
            )
            .setTimestamp(),
        ],
      });
    }

    // ==================================================
    // /RELEASE
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "release"
    ) {
      if (!isTicketStaff(interaction)) {
        return interaction.reply({
          content: "❌ Solo el equipo de soporte.",
          ephemeral: true,
        });
      }

      const ticket = getTicket(interaction.channel.id);

      if (!ticket) {
        return interaction.reply({
          content: "❌ No estás dentro de un ticket.",
          ephemeral: true,
        });
      }

      if (
        ticket.claimedBy !== interaction.user.id &&
        !isRealAdmin(interaction)
      ) {
        return interaction.reply({
          content:
            "❌ Solo el responsable actual puede liberar este ticket.",
          ephemeral: true,
        });
      }

      ticket.claimedBy = null;
      ticket.status = "waiting";

      saveDB();

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle("🙋 Ticket liberado")
            .setDescription(
              [
                `${interaction.user} ha liberado esta solicitud.`,
                "",
                "### 🟡 Estado",
                "**Esperando atención**",
                "",
                "Otro miembro del equipo ya puede reclamarla.",
              ].join("\n")
            )
            .setTimestamp(),
        ],
      });
    }

    // ==================================================
    // /NOTICE
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "notice"
    ) {
      if (!isTicketStaff(interaction)) {
        return interaction.reply({
          content: "❌ Solo el equipo de soporte.",
          ephemeral: true,
        });
      }

      const ticket = getTicket(interaction.channel.id);

      if (!ticket) {
        return interaction.reply({
          content:
            "❌ Este comando solo funciona dentro de tickets.",
          ephemeral: true,
        });
      }

      const message =
        interaction.options.getString("mensaje");

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setAuthor({
              name: "Aviso del Equipo de Soporte",
            })
            .setTitle("📢 Información importante")
            .setDescription(message)
            .addFields({
              name: "Publicado por",
              value: `${interaction.user}`,
              inline: true,
            })
            .setFooter({
              text: "Centro de Soporte • Aviso oficial",
            })
            .setTimestamp(),
        ],
      });
    }

    // ==================================================
    // /STATS
    // ==================================================

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "stats"
    ) {
      if (!isTicketStaff(interaction)) {
        return interaction.reply({
          content:
            "❌ Las estadísticas son exclusivas del equipo.",
          ephemeral: true,
        });
      }

      const config = getGuildConfig(interaction.guild.id);

      const ratings = config.stats.ratings;

      const average =
        ratings.length > 0
          ? (
              ratings.reduce((a, b) => a + b, 0) /
              ratings.length
            ).toFixed(2)
          : "Sin datos";

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("📊 Estadísticas de Soporte")
            .setDescription(
              "Resumen general de la actividad del sistema de tickets."
            )
            .addFields(
              {
                name: "📨 Tickets creados",
                value: `${config.stats.created}`,
                inline: true,
              },
              {
                name: "✅ Tickets cerrados",
                value: `${config.stats.closed}`,
                inline: true,
              },
              {
                name: "⭐ Valoraciones",
                value: `${ratings.length}`,
                inline: true,
              },
              {
                name: "📈 Promedio",
                value:
                  average === "Sin datos"
                    ? average
                    : `⭐ ${average}/5`,
                inline: true,
              }
            )
            .setTimestamp(),
        ],
        ephemeral: true,
      });
    }

    // ==================================================
    // BOTÓN CERRAR - FLUJO DE 3 PASOS
    // ==================================================

    if (
      interaction.isButton() &&
      interaction.customId === "close_ticket"
    ) {
      const ticket = getTicket(interaction.channel.id);

      if (!ticket) {
        return interaction.reply({
          content: "❌ Este ticket ya no está registrado.",
          ephemeral: true,
        });
      }

      if (!isTicketStaff(interaction)) {
        return interaction.reply({
          content:
            "❌ Solo el equipo de soporte puede gestionar el cierre.",
          ephemeral: true,
        });
      }

      if (!ticket.claimedBy) {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("⚠️ Ticket sin responsable")
              .setDescription(
                "Antes de iniciar el proceso de cierre, un miembro del equipo debe reclamar esta solicitud."
              ),
          ],
          ephemeral: true,
        });
      }

      if (
        ticket.claimedBy !== interaction.user.id &&
        !isRealAdmin(interaction)
      ) {
        return interaction.reply({
          content:
            `🔒 Este ticket está siendo atendido por <@${ticket.claimedBy}>. Solo esa persona puede iniciar su cierre.`,
          ephemeral: true,
        });
      }

      // ================================================
      // PRIMER CLIC → VALORACIÓN
      // ================================================

      if (ticket.status === "claimed") {
        ticket.status = "rating";
        saveDB();

        const ratingEmbed = new EmbedBuilder()
          .setColor(0xfee75c)
          .setAuthor({
            name: "Experiencia de Soporte",
            iconURL: interaction.guild.iconURL() || undefined,
          })
          .setTitle("⭐ Valora la atención recibida")
          .setDescription(
            [
              `<@${ticket.ownerId}>, la atención de tu solicitud está llegando a su etapa final.`,
              "",
              `Has sido atendido por <@${ticket.claimedBy}>.`,
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "### ¿Cómo valorarías la atención?",
              "Selecciona una puntuación entre **1 y 5 estrellas**.",
              "",
              "Tu opinión se utilizará para conocer la calidad del servicio y ayudar al equipo a mejorar.",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "🔒 **El ticket todavía no será eliminado.**",
              "Después de tu valoración, el responsable continuará con el proceso de cierre.",
            ].join("\n")
          )
          .setFooter({
            text: "Centro de Soporte • Tu opinión importa",
          })
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`rating_${interaction.channel.id}_1`)
            .setLabel("1")
            .setEmoji("⭐")
            .setStyle(ButtonStyle.Secondary),

          new ButtonBuilder()
            .setCustomId(`rating_${interaction.channel.id}_2`)
            .setLabel("2")
            .setEmoji("⭐")
            .setStyle(ButtonStyle.Secondary),

          new ButtonBuilder()
            .setCustomId(`rating_${interaction.channel.id}_3`)
            .setLabel("3")
            .setEmoji("⭐")
            .setStyle(ButtonStyle.Secondary),

          new ButtonBuilder()
            .setCustomId(`rating_${interaction.channel.id}_4`)
            .setLabel("4")
            .setEmoji("⭐")
            .setStyle(ButtonStyle.Primary),

          new ButtonBuilder()
            .setCustomId(`rating_${interaction.channel.id}_5`)
            .setLabel("5")
            .setEmoji("⭐")
            .setStyle(ButtonStyle.Success)
        );

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("🔒 Proceso de cierre iniciado")
              .setDescription(
                [
                  `${interaction.user} ha iniciado el proceso de finalización.`,
                  "",
                  "### Paso 1 de 3",
                  "⭐ **Esperando valoración del usuario**",
                  "",
                  "Cuando el usuario termine de valorar, el responsable deberá pulsar nuevamente **Cerrar ticket**.",
                ].join("\n")
              )
              .setTimestamp(),
          ],
        });

        return interaction.channel.send({
          content: `<@${ticket.ownerId}>`,
          embeds: [ratingEmbed],
          components: [row],
        });
      }

      // Todavía no valoró
      if (ticket.status === "rating") {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfee75c)
              .setTitle("⭐ Valoración pendiente")
              .setDescription(
                [
                  "Todavía no se puede continuar con el cierre.",
                  "",
                  `<@${ticket.ownerId}> debe completar primero la valoración mostrada en este ticket.`,
                  "",
                  "Una vez enviada, podrás pulsar nuevamente **Cerrar ticket**.",
                ].join("\n")
              ),
          ],
          ephemeral: true,
        });
      }

      // ================================================
      // SEGUNDO CLIC → MOTIVO
      // ================================================

      if (ticket.status === "reason") {
        const modal = new ModalBuilder()
          .setCustomId(`close_reason_${interaction.channel.id}`)
          .setTitle("Finalizar atención");

        const input = new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Motivo del cierre")
          .setPlaceholder(
            "Ejemplo: La solicitud fue resuelta correctamente."
          )
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMinLength(3)
          .setMaxLength(500);

        modal.addComponents(
          new ActionRowBuilder().addComponents(input)
        );

        return interaction.showModal(modal);
      }

      // ================================================
      // TERCER CLIC → ELIMINAR
      // ================================================

      if (ticket.status === "confirm") {
        ticket.status = "closing";
        saveDB();

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("🔒 Ticket finalizado")
              .setDescription(
                [
                  "El proceso de atención ha finalizado correctamente.",
                  "",
                  `👤 **Usuario:** <@${ticket.ownerId}>`,
                  `🛡️ **Atendido por:** <@${ticket.claimedBy}>`,
                  `⭐ **Valoración:** ${"⭐".repeat(
                    ticket.rating || 0
                  )} ${ticket.rating || 0}/5`,
                  "",
                  "### 📋 Motivo del cierre",
                  ticket.closeReason || "Sin especificar.",
                  "",
                  "━━━━━━━━━━━━━━━━━━━━",
                  "",
                  "⏳ **Este ticket será eliminado en 5 segundos.**",
                  "La transcripción será guardada antes de eliminar el canal.",
                ].join("\n")
              )
              .setFooter({
                text: "Centro de Soporte • Solicitud finalizada",
              })
              .setTimestamp(),
          ],
        });

        // Transcript
        const transcriptBuffer =
          await createTranscript(interaction.channel, ticket);

        const transcript = new AttachmentBuilder(
          transcriptBuffer,
          {
            name: `transcript-${interaction.channel.name}.txt`,
          }
        );

        const config = getGuildConfig(interaction.guild.id);

        // Logs
        if (config.transactionLogs) {
          const logChannel =
            interaction.guild.channels.cache.get(
              config.transactionLogs
            );

          if (logChannel) {
            const info = categoryInfo(ticket.category);

            await logChannel
              .send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(0xed4245)
                    .setTitle("📜 Ticket Finalizado")
                    .setDescription(
                      "Una solicitud de soporte ha sido cerrada correctamente."
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
                        name: "📂 Categoría",
                        value: `${info.emoji} ${info.name}`,
                        inline: true,
                      },
                      {
                        name: "⭐ Valoración",
                        value: `${ticket.rating}/5`,
                        inline: true,
                      },
                      {
                        name: "📋 Motivo",
                        value: ticket.closeReason,
                      }
                    )
                    .setFooter({
                      text:
                        "📎 Transcripción adjunta al registro",
                    })
                    .setTimestamp(),
                ],
                files: [transcript],
              })
              .catch(console.error);
          }
        }

        // MD
        const owner =
          await interaction.guild.members
            .fetch(ticket.ownerId)
            .catch(() => null);

        if (owner) {
          const info = categoryInfo(ticket.category);

          await owner
            .send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0x5865f2)
                  .setTitle("🔒 Solicitud finalizada")
                  .setDescription(
                    [
                      `Tu solicitud de soporte en **${interaction.guild.name}** ha sido finalizada.`,
                      "",
                      `📂 **Categoría:** ${info.emoji} ${info.name}`,
                      `🛡️ **Atendido por:** <@${ticket.claimedBy}>`,
                      `⭐ **Tu valoración:** ${ticket.rating}/5`,
                      "",
                      "### 📋 Motivo del cierre",
                      ticket.closeReason,
                      "",
                      "Gracias por utilizar nuestro sistema de soporte.",
                      "Si necesitas ayuda nuevamente, puedes crear una nueva solicitud.",
                    ].join("\n")
                  )
                  .setFooter({
                    text: `${interaction.guild.name} • Centro de Soporte`,
                    iconURL:
                      interaction.guild.iconURL() || undefined,
                  })
                  .setTimestamp(),
              ],
            })
            .catch(() => {});
        }

        config.stats.closed++;

        const staffStats = ensureStaffStats(
          interaction.guild.id,
          ticket.claimedBy
        );

        staffStats.closed++;

        saveDB();

        const channel = interaction.channel;
        const channelId = channel.id;

        setTimeout(async () => {
          delete db.tickets[channelId];
          saveDB();

          await channel
            .delete("Ticket finalizado")
            .catch(() => {});
        }, 5000);

        return;
      }
    }

    // ==================================================
    // BOTONES DE VALORACIÓN
    // ==================================================

    if (
      interaction.isButton() &&
      interaction.customId.startsWith("rating_")
    ) {
      const parts = interaction.customId.split("_");

      const channelId = parts[1];
      const stars = Number(parts[2]);

      const ticket = getTicket(channelId);

      if (!ticket || ticket.status !== "rating") {
        return interaction.reply({
          content:
            "❌ Esta solicitud de valoración ya no está disponible.",
          ephemeral: true,
        });
      }

      if (interaction.user.id !== ticket.ownerId) {
        return interaction.reply({
          content:
            "❌ Solo el propietario del ticket puede enviar esta valoración.",
          ephemeral: true,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`rating_modal_${channelId}_${stars}`)
        .setTitle(`${stars}/5 estrellas`);

      const comment = new TextInputBuilder()
        .setCustomId("comment")
        .setLabel("Cuéntanos sobre tu experiencia")
        .setPlaceholder(
          "¿Qué te pareció la atención recibida?"
        )
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500);

      modal.addComponents(
        new ActionRowBuilder().addComponents(comment)
      );

      return interaction.showModal(modal);
    }

    // ==================================================
    // GUARDAR VALORACIÓN
    // ==================================================

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("rating_modal_")
    ) {
      const parts = interaction.customId.split("_");

      const channelId = parts[2];
      const stars = Number(parts[3]);

      const ticket = getTicket(channelId);

      if (!ticket || ticket.status !== "rating") {
        return interaction.reply({
          content: "❌ Esta valoración ya no está disponible.",
          ephemeral: true,
        });
      }

      if (interaction.user.id !== ticket.ownerId) {
        return interaction.reply({
          content: "❌ Esta valoración no te pertenece.",
          ephemeral: true,
        });
      }

      const comment =
        interaction.fields
          .getTextInputValue("comment")
          .trim() || "Sin comentario.";

      ticket.rating = stars;
      ticket.ratingComment = comment;

      // Ahora el segundo clic en cerrar pedirá el motivo.
      ticket.status = "reason";

      const config = getGuildConfig(interaction.guild.id);

      config.stats.ratings.push(stars);

      const staffStats = ensureStaffStats(
        interaction.guild.id,
        ticket.claimedBy
      );

      staffStats.ratings.push(stars);

      saveDB();

      // Logs valoración
      if (config.ratingLogs) {
        const logChannel =
          interaction.guild.channels.cache.get(
            config.ratingLogs
          );

        if (logChannel) {
          await logChannel
            .send({
              embeds: [
                new EmbedBuilder()
                  .setColor(0xfee75c)
                  .setTitle("⭐ Nueva valoración de soporte")
                  .setDescription(
                    [
                      `### ${"⭐".repeat(stars)}${"☆".repeat(
                        5 - stars
                      )}`,
                      `**${stars}/5 estrellas**`,
                      "",
                      "Una nueva valoración ha sido registrada.",
                    ].join("\n")
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
                      name: "💬 Comentario",
                      value: comment,
                    }
                  )
                  .setFooter({
                    text: `${interaction.guild.name} • Valoraciones`,
                  })
                  .setTimestamp(),
              ],
            })
            .catch(() => {});
        }
      }

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("⭐ ¡Gracias por tu valoración!")
            .setDescription(
              [
                `### ${"⭐".repeat(stars)}${"☆".repeat(
                  5 - stars
                )}`,
                `Has valorado la atención con **${stars}/5 estrellas**.`,
                "",
                "Tu opinión ha sido registrada correctamente.",
                "",
                `🛡️ **Atendido por:** <@${ticket.claimedBy}>`,
                "",
                "Gracias por dedicar unos segundos a compartir tu experiencia.",
              ].join("\n")
            )
            .setFooter({
              text: "Centro de Soporte • Valoración registrada",
            })
            .setTimestamp(),
        ],
      });

      return interaction.channel.send({
        content: `<@${ticket.claimedBy}>`,
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🔒 Paso 1 completado")
            .setDescription(
              [
                "La valoración del usuario ha sido registrada.",
                "",
                "### Paso 2 de 3",
                "📝 **Registrar motivo del cierre**",
                "",
                "El responsable del ticket debe pulsar nuevamente el botón **Cerrar ticket** y especificar el motivo por el que se finaliza la solicitud.",
              ].join("\n")
            )
            .setTimestamp(),
        ],
      });
    }

    // ==================================================
    // MODAL MOTIVO DE CIERRE
    // ==================================================

    if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith("close_reason_")
    ) {
      const channelId =
        interaction.customId.replace("close_reason_", "");

      const ticket = getTicket(channelId);

      if (!ticket || ticket.status !== "reason") {
        return interaction.reply({
          content:
            "❌ Este ticket no está esperando un motivo de cierre.",
          ephemeral: true,
        });
      }

      if (
        ticket.claimedBy !== interaction.user.id &&
        !isRealAdmin(interaction)
      ) {
        return interaction.reply({
          content:
            "❌ Solo el responsable del ticket puede completar este paso.",
          ephemeral: true,
        });
      }

      const reason =
        interaction.fields.getTextInputValue("reason");

      ticket.closeReason = reason;
      ticket.status = "confirm";

      saveDB();

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle("📝 Motivo de cierre registrado")
            .setDescription(
              [
                "El motivo de finalización ha sido guardado correctamente.",
                "",
                "### 📋 Motivo",
                reason,
                "",
                "━━━━━━━━━━━━━━━━━━━━",
                "",
                "### Paso 3 de 3",
                "🔒 **Confirmar cierre definitivo**",
                "",
                "Pulsa nuevamente **Cerrar ticket**.",
                "",
                "Al hacerlo:",
                "• Se generará la transcripción.",
                "• Se enviará el registro a los logs.",
                "• El usuario recibirá el motivo por MD.",
                "• El canal será eliminado después de **5 segundos**.",
              ].join("\n")
            )
            .setFooter({
              text: "Centro de Soporte • Confirmación pendiente",
            })
            .setTimestamp(),
        ],
      });
    }
  } catch (error) {
    console.error("❌ Error en interactionCreate:", error);

    await safeReply(interaction, {
      content:
        "❌ Ocurrió un error mientras procesaba esta acción.",
      ephemeral: true,
    });
  }
});

// ======================================================
// SERVIDOR HTTP
// ======================================================

const PORT = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
    });

    res.end("Sistema de tickets online.");
  })
  .listen(PORT, () => {
    console.log(`🌐 Servidor HTTP activo en puerto ${PORT}`);
  });

// ======================================================
// ERRORES
// ======================================================

process.on("unhandledRejection", error => {
  console.error("❌ Unhandled Rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("❌ Uncaught Exception:", error);
});

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);
