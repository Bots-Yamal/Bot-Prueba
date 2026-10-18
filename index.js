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
  console.error("❌ DISCORD_TOKEN no está configurado.");
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
// DATABASE
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
    const data = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    if (!data.guilds) data.guilds = {};
    if (!data.tickets) data.tickets = {};

    return data;
  } catch {
    return defaultDB();
  }
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(db, null, 2)
    );
  } catch (error) {
    console.error("❌ Error guardando database:", error);
  }
}

function getGuildConfig(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = {
      staffRole: null,

      // Categoría de Discord donde se crean los tickets
      ticketCategory: null,

      ratingLogs: null,
      transactionLogs: null,

      blacklist: {},

      customCategories: {},

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
  if (!config.customCategories) config.customCategories = {};

  if (!config.stats) {
    config.stats = {
      created: 0,
      closed: 0,
      ratings: [],
      staff: {},
    };
  }

  if (!config.stats.ratings) {
    config.stats.ratings = [];
  }

  if (!config.stats.staff) {
    config.stats.staff = {};
  }

  return config;
}

// ======================================================
// CATEGORÍAS PREDETERMINADAS
// ======================================================

const DEFAULT_CATEGORIES = {
  soporte: {
    name: "Soporte General",
    emoji: "📩",
    question: "¿En qué podemos ayudarte?",
  },

  compras: {
    name: "Compras / Transacciones",
    emoji: "💳",
    question: "¿Qué ocurrió con tu compra o transacción?",
  },

  alianzas: {
    name: "Alianzas",
    emoji: "🤝",
    question: "¿Cuál es tu propuesta?",
  },
};

// ======================================================
// UTILIDADES
// ======================================================

function isAdmin(interaction) {
  return interaction.member.permissions.has(
    PermissionFlagsBits.Administrator
  );
}

function hasStaffRole(member, guildId) {
  const config = getGuildConfig(guildId);

  if (!config.staffRole) return false;

  return member.roles.cache.has(config.staffRole);
}

function isStaff(interaction) {
  return (
    isAdmin(interaction) ||
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
      .slice(0, 70) || "ticket"
  );
}

function getCategory(guildId, categoryId) {
  const config = getGuildConfig(guildId);

  if (DEFAULT_CATEGORIES[categoryId]) {
    return DEFAULT_CATEGORIES[categoryId];
  }

  if (config.customCategories[categoryId]) {
    return config.customCategories[categoryId];
  }

  return {
    name: "Ticket",
    emoji: "🎫",
    question: "¿En qué podemos ayudarte?",
  };
}

function getAllCategories(guildId) {
  const config = getGuildConfig(guildId);

  return {
    ...DEFAULT_CATEGORIES,
    ...config.customCategories,
  };
}

function getTicket(channelId) {
  return db.tickets[channelId] || null;
}

function getStatus(ticket) {
  if (ticket.status === "waiting") {
    return "🟡 Esperando atención";
  }

  if (ticket.status === "claimed") {
    return "🟢 En atención";
  }

  if (ticket.status === "rating") {
    return "⭐ Esperando valoración";
  }

  if (ticket.status === "reason") {
    return "📝 Motivo de cierre";
  }

  if (ticket.status === "confirm") {
    return "🔒 Pendiente de cierre";
  }

  if (ticket.status === "closing") {
    return "🔴 Cerrando";
  }

  return "⚪ Desconocido";
}

function staffStats(guildId, userId) {
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
  const messages = [];
  let lastId;

  try {
    while (messages.length < 1000) {
      const options = {
        limit: 100,
      };

      if (lastId) {
        options.before = lastId;
      }

      const batch =
        await channel.messages.fetch(options);

      if (!batch.size) break;

      messages.push(...batch.values());

      lastId = batch.last().id;

      if (batch.size < 100) break;
    }
  } catch (error) {
    console.error("❌ Error obteniendo mensajes:", error);
  }

  messages.sort(
    (a, b) => a.createdTimestamp - b.createdTimestamp
  );

  const category = getCategory(
    ticket.guildId,
    ticket.category
  );

  const lines = [];

  lines.push(
    "===================================================="
  );
  lines.push("              TRANSCRIPT DEL TICKET");
  lines.push(
    "===================================================="
  );
  lines.push("");

  lines.push(`Servidor: ${channel.guild.name}`);
  lines.push(`Canal: #${channel.name}`);
  lines.push(`Usuario: ${ticket.ownerId}`);
  lines.push(`Categoría: ${category.name}`);
  lines.push(`Pregunta: ${category.question}`);
  lines.push(`Respuesta: ${ticket.reason}`);
  lines.push(
    `Staff: ${ticket.claimedBy || "Sin asignar"}`
  );
  lines.push(
    `Valoración: ${
      ticket.rating
        ? `${ticket.rating}/5`
        : "Sin valoración"
    }`
  );
  lines.push(
    `Comentario: ${
      ticket.ratingComment || "Sin comentario"
    }`
  );
  lines.push(
    `Motivo de cierre: ${
      ticket.closeReason || "Sin especificar"
    }`
  );

  lines.push("");
  lines.push(
    "===================================================="
  );
  lines.push("                     MENSAJES");
  lines.push(
    "===================================================="
  );
  lines.push("");

  for (const message of messages) {
    const date = new Date(
      message.createdTimestamp
    ).toLocaleString();

    lines.push(
      `[${date}] ${message.author.tag}`
    );

    if (message.content) {
      lines.push(message.content);
    }

    for (const attachment of message.attachments.values()) {
      lines.push(
        `📎 ${attachment.name}: ${attachment.url}`
      );
    }

    lines.push("");
  }

  return Buffer.from(lines.join("\n"), "utf8");
}

// ======================================================
// COMANDOS
// ======================================================

const commands = [
  // ================================================
  // TICKET
  // ================================================

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Sistema de tickets")

    .addSubcommand(sub =>
      sub
        .setName("panel")
        .setDescription("Publica el panel de tickets")
    )

    .addSubcommand(sub =>
      sub
        .setName("info")
        .setDescription(
          "Muestra información del ticket actual"
        )
    ),

  // ================================================
  // ADD CATEGORY
  // ================================================

  new SlashCommandBuilder()
    .setName("addcategory")
    .setDescription(
      "Crea una categoría personalizada de tickets"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )

    .addStringOption(option =>
      option
        .setName("nombre")
        .setDescription(
          "Nombre que aparecerá en el panel"
        )
        .setRequired(true)
        .setMaxLength(80)
    )

    .addStringOption(option =>
      option
        .setName("pregunta")
        .setDescription(
          "Pregunta que aparecerá al crear el ticket"
        )
        .setRequired(true)
        .setMaxLength(200)
    ),

  // ================================================
  // REMOVE CATEGORY
  // ================================================

  new SlashCommandBuilder()
    .setName("removecategory")
    .setDescription(
      "Elimina una categoría personalizada"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )

    .addStringOption(option =>
      option
        .setName("categoria")
        .setDescription(
          "Nombre de la categoría que quieres eliminar"
        )
        .setRequired(true)
        .setAutocomplete(true)
    ),

  // ================================================
  // CATEGORY TICKET
  // ================================================

  new SlashCommandBuilder()
    .setName("category")
    .setDescription(
      "Configura dónde se crearán los tickets"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )

    .addSubcommand(sub =>
      sub
        .setName("ticket")
        .setDescription(
          "Establece la categoría de Discord para los tickets"
        )
        .addChannelOption(option =>
          option
            .setName("categoria")
            .setDescription(
              "Categoría de Discord donde aparecerán los tickets"
            )
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    ),

  // ================================================
  // ADMIN
  // ================================================

  new SlashCommandBuilder()
    .setName("admin")
    .setDescription(
      "Configuración administrativa del sistema"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )

    .addSubcommand(sub =>
      sub
        .setName("rol")
        .setDescription(
          "Configura el rol del equipo de soporte"
        )
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
        .setDescription(
          "Quita el rol de soporte"
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("ver")
        .setDescription(
          "Muestra la configuración"
        )
    ),

  // ================================================
  // LOGS
  // ================================================

  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configura los logs")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )

    .addSubcommand(sub =>
      sub
        .setName("valoracion")
        .setDescription(
          "Configura los logs de valoraciones"
        )
        .addChannelOption(option =>
          option
            .setName("canal")
            .setDescription("Canal")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("transacciones")
        .setDescription(
          "Configura los logs de cierres"
        )
        .addChannelOption(option =>
          option
            .setName("canal")
            .setDescription("Canal")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),

  // ================================================
  // RENAME
  // ================================================

  new SlashCommandBuilder()
    .setName("rename")
    .setDescription(
      "Cambia el nombre del ticket"
    )
    .addStringOption(option =>
      option
        .setName("nombre")
        .setDescription("Nuevo nombre")
        .setRequired(true)
        .setMaxLength(80)
    ),

  // ================================================
  // USER
  // ================================================

  new SlashCommandBuilder()
    .setName("user")
    .setDescription(
      "Administra usuarios del ticket"
    )

    .addSubcommand(sub =>
      sub
        .setName("invite")
        .setDescription(
          "Añade un usuario al ticket"
        )
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
        .setDescription(
          "Retira un usuario del ticket"
        )
        .addUserOption(option =>
          option
            .setName("usuario")
            .setDescription("Usuario")
            .setRequired(true)
        )
    ),

  // ================================================
  // TRANSFER
  // ================================================

  new SlashCommandBuilder()
    .setName("transfer")
    .setDescription(
      "Transfiere un ticket"
    )
    .addUserOption(option =>
      option
        .setName("usuario")
        .setDescription(
          "Nuevo miembro del staff"
        )
        .setRequired(true)
    ),

  // ================================================
  // RELEASE
  // ================================================

  new SlashCommandBuilder()
    .setName("release")
    .setDescription(
      "Libera un ticket"
    ),

  // ================================================
  // STATS
  // ================================================

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "Muestra estadísticas del sistema"
    ),

  // ================================================
  // BLACKLIST
  // ================================================

  new SlashCommandBuilder()
    .setName("blacklist")
    .setDescription(
      "Administra usuarios restringidos"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )

    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription(
          "Añade un usuario"
        )
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
        .setDescription(
          "Retira un usuario"
        )
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
  console.log(
    `✅ Conectado como ${client.user.tag}`
  );

  client.user.setPresence({
    activities: [
      {
        name: "🎫 Sistema profesional de tickets",
      },
    ],
    status: "online",
  });

  try {
    const rest = new REST({
      version: "10",
    }).setToken(TOKEN);

    await rest.put(
      Routes.applicationCommands(client.user.id),
      {
        body: commands,
      }
    );

    console.log("✅ Comandos registrados.");
  } catch (error) {
    console.error(
      "❌ Error registrando comandos:",
      error
    );
  }
});

// ======================================================
// AUTOCOMPLETADO
// ======================================================

client.on(
  "interactionCreate",
  async interaction => {
    if (!interaction.isAutocomplete()) return;

    if (
      interaction.commandName ===
      "removecategory"
    ) {
      const config = getGuildConfig(
        interaction.guild.id
      );

      const focused =
        interaction.options
          .getFocused()
          .toLowerCase();

      const choices = Object.entries(
        config.customCategories
      )
        .map(([id, category]) => ({
          name: category.name,
          value: id,
        }))
        .filter(item =>
          item.name
            .toLowerCase()
            .includes(focused)
        )
        .slice(0, 25);

      return interaction.respond(choices);
    }
  }
);

// ======================================================
// INTERACTIONS
// ======================================================

client.on(
  "interactionCreate",
  async interaction => {
    try {
      // ================================================
      // /ADDCATEGORY
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "addcategory"
      ) {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo los administradores reales pueden crear categorías.",
            ephemeral: true,
          });
        }

        const name =
          interaction.options.getString(
            "nombre"
          );

        const question =
          interaction.options.getString(
            "pregunta"
          );

        const config = getGuildConfig(
          interaction.guild.id
        );

        const id = cleanName(name);

        if (
          DEFAULT_CATEGORIES[id] ||
          config.customCategories[id]
        ) {
          return interaction.reply({
            content:
              "❌ Ya existe una categoría con ese nombre.",
            ephemeral: true,
          });
        }

        config.customCategories[id] = {
          name,
          emoji: "🎫",
          question,
        };

        saveDB();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle(
                "✅ Categoría creada"
              )
              .setDescription(
                [
                  `La categoría **${name}** ya está disponible en el panel.`,
                  "",
                  "### 🎫 Nombre",
                  name,
                  "",
                  "### ❓ Pregunta",
                  question,
                  "",
                  "Ahora solo necesitas volver a publicar el panel con:",
                  "`/ticket panel`",
                ].join("\n")
              )
              .setTimestamp(),
          ],
          ephemeral: true,
        });
      }

      // ================================================
      // /REMOVECATEGORY
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "removecategory"
      ) {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo los administradores reales pueden eliminar categorías.",
            ephemeral: true,
          });
        }

        const id =
          interaction.options.getString(
            "categoria"
          );

        const config = getGuildConfig(
          interaction.guild.id
        );

        if (
          !config.customCategories[id]
        ) {
          return interaction.reply({
            content:
              "❌ Esa categoría personalizada no existe.",
            ephemeral: true,
          });
        }

        const name =
          config.customCategories[id].name;

        delete config.customCategories[id];

        saveDB();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle(
                "🗑️ Categoría eliminada"
              )
              .setDescription(
                `La categoría **${name}** ya no aparecerá en los nuevos paneles.`
              )
              .setTimestamp(),
          ],
          ephemeral: true,
        });
      }

      // ================================================
      // /CATEGORY TICKET
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "category"
      ) {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo los administradores reales pueden configurar esto.",
            ephemeral: true,
          });
        }

        const discordCategory =
          interaction.options.getChannel(
            "categoria"
          );

        const config = getGuildConfig(
          interaction.guild.id
        );

        config.ticketCategory =
          discordCategory.id;

        saveDB();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle(
                "📁 Categoría de tickets configurada"
              )
              .setDescription(
                [
                  "Todos los nuevos tickets se crearán dentro de:",
                  "",
                  `📂 **${discordCategory.name}**`,
                  "",
                  "Comando utilizado:",
                  "`/category ticket categoria`",
                ].join("\n")
              )
              .setTimestamp(),
          ],
          ephemeral: true,
        });
      }

      // ================================================
      // /TICKET PANEL
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "ticket"
      ) {
        const sub =
          interaction.options.getSubcommand();

        // PANEL
        if (sub === "panel") {
          if (!isAdmin(interaction)) {
            return interaction.reply({
              content:
                "❌ Solo los administradores pueden publicar el panel.",
              ephemeral: true,
            });
          }

          const categories =
            getAllCategories(
              interaction.guild.id
            );

          const options = Object.entries(
            categories
          )
            .slice(0, 25)
            .map(([id, category]) => ({
              label: category.name.slice(
                0,
                100
              ),
              description:
                category.question.slice(
                  0,
                  100
                ),
              value: id,
              emoji:
                category.emoji || "🎫",
            }));

          const embed =
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setAuthor({
                name: `${interaction.guild.name} • Soporte`,
                iconURL:
                  interaction.guild.iconURL() ||
                  undefined,
              })
              .setTitle(
                "🎫 Centro de Soporte"
              )
              .setDescription(
                [
                  "### ¿Necesitas ayuda?",
                  "",
                  "Bienvenido al centro oficial de soporte.",
                  "",
                  "Selecciona la categoría que corresponda con tu solicitud.",
                  "Al seleccionarla, tendrás que responder una pregunta antes de crear tu ticket.",
                  "",
                  "━━━━━━━━━━━━━━━━━━━━",
                  "",
                  "📌 **Información importante**",
                  "• Describe claramente tu solicitud.",
                  "• Adjunta pruebas cuando sea necesario.",
                  "• No abras tickets duplicados.",
                  "• El equipo de soporte atenderá tu solicitud cuando esté disponible.",
                  "",
                  "━━━━━━━━━━━━━━━━━━━━",
                  "",
                  "**Selecciona una categoría para comenzar.**",
                ].join("\n")
              )
              .setThumbnail(
                interaction.guild.iconURL() ||
                  null
              )
              .setFooter({
                text:
                  "Sistema de Soporte • Atención organizada",
              })
              .setTimestamp();

          const menu =
            new StringSelectMenuBuilder()
              .setCustomId(
                "ticket_category_menu"
              )
              .setPlaceholder(
                "🎫 Selecciona una categoría..."
              )
              .addOptions(options);

          await interaction.channel.send(
            {
              embeds: [embed],
              components: [
                new ActionRowBuilder().addComponents(
                  menu
                ),
              ],
            }
          );

          return interaction.reply({
            content:
              "✅ Panel publicado correctamente.",
            ephemeral: true,
          });
        }

        // INFO
        if (sub === "info") {
          if (!isStaff(interaction)) {
            return interaction.reply({
              content:
                "❌ Solo el equipo de soporte puede utilizar esto.",
              ephemeral: true,
            });
          }

          const ticket =
            getTicket(
              interaction.channel.id
            );

          if (!ticket) {
            return interaction.reply({
              content:
                "❌ Este canal no es un ticket.",
              ephemeral: true,
            });
          }

          const category =
            getCategory(
              interaction.guild.id,
              ticket.category
            );

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(
                  "📋 Información del Ticket"
                )
                .addFields(
                  {
                    name: "👤 Usuario",
                    value: `<@${ticket.ownerId}>`,
                    inline: true,
                  },
                  {
                    name: "🛡️ Responsable",
                    value:
                      ticket.claimedBy
                        ? `<@${ticket.claimedBy}>`
                        : "Sin asignar",
                    inline: true,
                  },
                  {
                    name: "📂 Categoría",
                    value: `${category.emoji} ${category.name}`,
                    inline: true,
                  },
                  {
                    name: "📊 Estado",
                    value:
                      getStatus(ticket),
                    inline: true,
                  },
                  {
                    name: "❓ Pregunta",
                    value:
                      category.question,
                  },
                  {
                    name: "📝 Respuesta",
                    value:
                      ticket.reason,
                  }
                )
                .setTimestamp(),
            ],
            ephemeral: true,
          });
        }
      }

      // ================================================
      // MENÚ DEL PANEL
      // ================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "ticket_category_menu"
      ) {
        const config =
          getGuildConfig(
            interaction.guild.id
          );

        if (
          config.blacklist[
            interaction.user.id
          ]
        ) {
          return interaction.reply({
            content:
              "❌ No puedes crear tickets en este servidor.",
            ephemeral: true,
          });
        }

        const categoryId =
          interaction.values[0];

        const category =
          getCategory(
            interaction.guild.id,
            categoryId
          );

        // Evitar múltiples tickets
        const existing =
          Object.values(db.tickets).find(
            ticket =>
              ticket.guildId ===
                interaction.guild.id &&
              ticket.ownerId ===
                interaction.user.id
          );

        if (existing) {
          const channel =
            interaction.guild.channels.cache.get(
              existing.channelId
            );

          if (channel) {
            return interaction.reply({
              content:
                `❌ Ya tienes un ticket abierto: ${channel}`,
              ephemeral: true,
            });
          }

          delete db.tickets[
            existing.channelId
          ];

          saveDB();
        }

        const modal =
          new ModalBuilder()
            .setCustomId(
              `ticket_create_${categoryId}`
            )
            .setTitle(
              category.name.slice(0, 45)
            );

        const question =
          new TextInputBuilder()
            .setCustomId("reason")
            .setLabel(
              category.question.slice(
                0,
                45
              )
            )
            .setPlaceholder(
              "Escribe aquí tu respuesta..."
            )
            .setStyle(
              TextInputStyle.Paragraph
            )
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(1000);

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            question
          )
        );

        return interaction.showModal(
          modal
        );
      }

      // ================================================
      // CREAR TICKET
      // ================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          "ticket_create_"
        )
      ) {
        const categoryId =
          interaction.customId.replace(
            "ticket_create_",
            ""
          );

        const category =
          getCategory(
            interaction.guild.id,
            categoryId
          );

        const reason =
          interaction.fields.getTextInputValue(
            "reason"
          );

        const config =
          getGuildConfig(
            interaction.guild.id
          );

        await interaction.deferReply({
          ephemeral: true,
        });

        const existing =
          Object.values(db.tickets).find(
            ticket =>
              ticket.guildId ===
                interaction.guild.id &&
              ticket.ownerId ===
                interaction.user.id
          );

        if (existing) {
          const oldChannel =
            interaction.guild.channels.cache.get(
              existing.channelId
            );

          if (oldChannel) {
            return interaction.editReply({
              content:
                `❌ Ya tienes un ticket abierto: ${oldChannel}`,
            });
          }

          delete db.tickets[
            existing.channelId
          ];
        }

        const username =
          cleanName(
            interaction.user.username
          );

        let channelName =
          `ticket-${username}`;

        if (
          interaction.guild.channels.cache.some(
            channel =>
              channel.name ===
              channelName
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
          await interaction.guild.channels.create(
            {
              name: channelName,
              type: ChannelType.GuildText,

              parent:
                config.ticketCategory ||
                undefined,

              permissionOverwrites:
                overwrites,
            }
          );

        db.tickets[channel.id] = {
          channelId: channel.id,
          guildId:
            interaction.guild.id,
          ownerId:
            interaction.user.id,

          category: categoryId,

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

        // ============================================
        // MENSAJE SIEMPRE IGUAL
        // SOLO CAMBIAN CATEGORÍA/PREGUNTA
        // ============================================

        const embed =
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setAuthor({
              name:
                "Nueva solicitud de soporte",
              iconURL:
                interaction.user.displayAvatarURL(),
            })
            .setTitle(
              "🎫 Solicitud creada"
            )
            .setDescription(
              [
                `Bienvenido ${interaction.user}.`,
                "",
                "Tu solicitud ha sido creada correctamente.",
                "Un miembro de nuestro equipo la revisará lo antes posible.",
                "",
                "━━━━━━━━━━━━━━━━━━━━",
                "",
                `📂 **Categoría**`,
                `${category.emoji} ${category.name}`,
                "",
                `❓ **${category.question}**`,
                reason,
                "",
                "━━━━━━━━━━━━━━━━━━━━",
                "",
                "🟡 **Estado**",
                "Esperando atención",
                "",
                "Puedes enviar información adicional, capturas o archivos relacionados con tu solicitud mientras esperas.",
              ].join("\n")
            )
            .addFields({
              name: "👤 Solicitante",
              value:
                `${interaction.user}\n\`${interaction.user.id}\``,
              inline: true,
            })
            .setThumbnail(
              interaction.user.displayAvatarURL()
            )
            .setFooter({
              text:
                "Sistema de Soporte • Atención organizada",
              iconURL:
                interaction.guild.iconURL() ||
                undefined,
            })
            .setTimestamp();

        const buttons =
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(
                "claim_ticket"
              )
              .setLabel(
                "Reclamar ticket"
              )
              .setEmoji("🙋")
              .setStyle(
                ButtonStyle.Primary
              ),

            new ButtonBuilder()
              .setCustomId(
                "close_ticket"
              )
              .setLabel(
                "Cerrar ticket"
              )
              .setEmoji("🔒")
              .setStyle(
                ButtonStyle.Danger
              )
          );

        await channel.send({
          content:
            `${interaction.user}`,
          embeds: [embed],
          components: [buttons],
        });

        return interaction.editReply({
          content:
            `✅ Tu ticket ha sido creado correctamente: ${channel}`,
        });
      }

      // ================================================
      // RECLAMAR
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          "claim_ticket"
      ) {
        const ticket =
          getTicket(
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Este ticket no existe.",
            ephemeral: true,
          });
        }

        if (!isStaff(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo el equipo de soporte puede reclamar tickets.",
            ephemeral: true,
          });
        }

        if (ticket.claimedBy) {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  0xfee75c
                )
                .setTitle(
                  "⚠️ Ticket ya reclamado"
                )
                .setDescription(
                  [
                    "Este ticket ya está siendo atendido.",
                    "",
                    `🛡️ **Responsable:** <@${ticket.claimedBy}>`,
                  ].join("\n")
                ),
            ],
            ephemeral: true,
          });
        }

        ticket.claimedBy =
          interaction.user.id;

        ticket.status =
          "claimed";

        const stats =
          staffStats(
            interaction.guild.id,
            interaction.user.id
          );

        stats.claimed++;

        saveDB();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0x57f287
              )
              .setAuthor({
                name:
                  "Equipo de Soporte",
                iconURL:
                  interaction.user.displayAvatarURL(),
              })
              .setTitle(
                "🙋 Ticket reclamado"
              )
              .setDescription(
                [
                  `${interaction.user} ha tomado esta solicitud.`,
                  "",
                  "🟢 **Estado:** En atención",
                  "",
                  `👤 **Usuario:** <@${ticket.ownerId}>`,
                  `🛡️ **Responsable:** ${interaction.user}`,
                  "",
                  "El responsable gestionará la solicitud hasta finalizarla.",
                ].join("\n")
              )
              .setFooter({
                text:
                  "Sistema de Soporte • Ticket en atención",
              })
              .setTimestamp(),
          ],
        });
      }

      // ================================================
      // RENAME
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "rename"
      ) {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo el equipo de soporte.",
            ephemeral: true,
          });
        }

        const ticket =
          getTicket(
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Este comando solo funciona dentro de tickets.",
            ephemeral: true,
          });
        }

        const name =
          cleanName(
            interaction.options.getString(
              "nombre"
            )
          );

        await interaction.channel.setName(
          name
        );

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0x5865f2
              )
              .setTitle(
                "✏️ Ticket renombrado"
              )
              .setDescription(
                `${interaction.user} cambió el nombre del ticket a **#${name}**.`
              )
              .setTimestamp(),
          ],
        });
      }

      // ================================================
      // USER
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "user"
      ) {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo el equipo de soporte.",
            ephemeral: true,
          });
        }

        const ticket =
          getTicket(
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Este comando solo funciona dentro de tickets.",
            ephemeral: true,
          });
        }

        const sub =
          interaction.options.getSubcommand();

        const user =
          interaction.options.getUser(
            "usuario"
          );

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

          if (
            !ticket.invitedUsers.includes(
              user.id
            )
          ) {
            ticket.invitedUsers.push(
              user.id
            );
          }

          saveDB();

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  0x57f287
                )
                .setTitle(
                  "👤 Usuario añadido"
                )
                .setDescription(
                  `${user} ahora puede acceder a este ticket.`
                )
                .setTimestamp(),
            ],
          });
        }

        if (sub === "remove") {
          if (
            user.id ===
            ticket.ownerId
          ) {
            return interaction.reply({
              content:
                "❌ No puedes retirar al propietario del ticket.",
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
            ticket.invitedUsers.filter(
              id => id !== user.id
            );

          saveDB();

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  0xed4245
                )
                .setTitle(
                  "👤 Usuario retirado"
                )
                .setDescription(
                  `${user} ya no tiene acceso a este ticket.`
                )
                .setTimestamp(),
            ],
          });
        }
      }

      // ================================================
      // TRANSFER
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "transfer"
      ) {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo el equipo de soporte.",
            ephemeral: true,
          });
        }

        const ticket =
          getTicket(
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ No estás dentro de un ticket.",
            ephemeral: true,
          });
        }

        if (
          ticket.claimedBy !==
            interaction.user.id &&
          !isAdmin(interaction)
        ) {
          return interaction.reply({
            content:
              "❌ Solo el responsable o un administrador puede transferirlo.",
            ephemeral: true,
          });
        }

        const user =
          interaction.options.getUser(
            "usuario"
          );

        const member =
          await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (
          !member ||
          (!isAdmin({
            member,
          }) &&
            !hasStaffRole(
              member,
              interaction.guild.id
            ))
        ) {
          return interaction.reply({
            content:
              "❌ Ese usuario no pertenece al equipo de soporte.",
            ephemeral: true,
          });
        }

        ticket.claimedBy =
          user.id;

        ticket.status =
          "claimed";

        saveDB();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0x5865f2
              )
              .setTitle(
                "🔄 Ticket transferido"
              )
              .setDescription(
                [
                  `🛡️ **Nuevo responsable:** ${user}`,
                  `👤 **Transferido por:** ${interaction.user}`,
                  "",
                  "La solicitud continuará bajo la responsabilidad del nuevo miembro.",
                ].join("\n")
              )
              .setTimestamp(),
          ],
        });
      }

      // ================================================
      // RELEASE
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "release"
      ) {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo el equipo de soporte.",
            ephemeral: true,
          });
        }

        const ticket =
          getTicket(
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Este canal no es un ticket.",
            ephemeral: true,
          });
        }

        if (
          ticket.claimedBy !==
            interaction.user.id &&
          !isAdmin(interaction)
        ) {
          return interaction.reply({
            content:
              "❌ Solo el responsable puede liberar el ticket.",
            ephemeral: true,
          });
        }

        ticket.claimedBy =
          null;

        ticket.status =
          "waiting";

        saveDB();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0xfee75c
              )
              .setTitle(
                "🙋 Ticket liberado"
              )
              .setDescription(
                [
                  `${interaction.user} ha liberado esta solicitud.`,
                  "",
                  "🟡 **Estado:** Esperando atención",
                  "",
                  "Otro miembro del equipo puede reclamarla.",
                ].join("\n")
              )
              .setTimestamp(),
          ],
        });
      }

      // ================================================
      // STATS
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "stats"
      ) {
        if (!isStaff(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo el equipo de soporte.",
            ephemeral: true,
          });
        }

        const config =
          getGuildConfig(
            interaction.guild.id
          );

        const ratings =
          config.stats.ratings;

        const average =
          ratings.length
            ? (
                ratings.reduce(
                  (a, b) =>
                    a + b,
                  0
                ) /
                ratings.length
              ).toFixed(2)
            : "Sin datos";

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0x5865f2
              )
              .setTitle(
                "📊 Estadísticas"
              )
              .addFields(
                {
                  name:
                    "🎫 Creados",
                  value:
                    `${config.stats.created}`,
                  inline: true,
                },
                {
                  name:
                    "🔒 Cerrados",
                  value:
                    `${config.stats.closed}`,
                  inline: true,
                },
                {
                  name:
                    "⭐ Valoraciones",
                  value:
                    `${ratings.length}`,
                  inline: true,
                },
                {
                  name:
                    "📈 Promedio",
                  value:
                    average ===
                    "Sin datos"
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

      // ================================================
      // BLACKLIST
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "blacklist"
      ) {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo administradores.",
            ephemeral: true,
          });
        }

        const config =
          getGuildConfig(
            interaction.guild.id
          );

        const sub =
          interaction.options.getSubcommand();

        const user =
          interaction.options.getUser(
            "usuario"
          );

        if (sub === "add") {
          const reason =
            interaction.options.getString(
              "motivo"
            );

          config.blacklist[
            user.id
          ] = {
            reason,
            addedBy:
              interaction.user.id,
            addedAt: Date.now(),
          };

          saveDB();

          return interaction.reply({
            content:
              `🚫 ${user} ha sido restringido del sistema de tickets.`,
            ephemeral: true,
          });
        }

        if (sub === "remove") {
          delete config.blacklist[
            user.id
          ];

          saveDB();

          return interaction.reply({
            content:
              `✅ ${user} ya puede crear tickets nuevamente.`,
            ephemeral: true,
          });
        }
      }

      // ================================================
      // ADMIN
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "admin"
      ) {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo administradores reales.",
            ephemeral: true,
          });
        }

        const sub =
          interaction.options.getSubcommand();

        const config =
          getGuildConfig(
            interaction.guild.id
          );

        if (sub === "rol") {
          const role =
            interaction.options.getRole(
              "rol"
            );

          config.staffRole =
            role.id;

          saveDB();

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  0x57f287
                )
                .setTitle(
                  "🛡️ Rol de soporte configurado"
                )
                .setDescription(
                  [
                    `${role} es ahora el equipo de soporte.`,
                    "",
                    "Podrán:",
                    "• Ver tickets.",
                    "• Reclamar tickets.",
                    "• Renombrarlos.",
                    "• Invitar y retirar usuarios.",
                    "• Transferir tickets.",
                    "• Liberarlos.",
                    "• Gestionar cierres.",
                    "",
                    "No podrán:",
                    "• Publicar paneles.",
                    "• Crear/eliminar categorías.",
                    "• Configurar logs.",
                    "• Usar `/admin`.",
                    "• Configurar dónde se crean los tickets.",
                  ].join("\n")
                )
                .setTimestamp(),
            ],
          });
        }

        if (sub === "quitar") {
          config.staffRole =
            null;

          saveDB();

          return interaction.reply({
            content:
              "✅ Rol de soporte eliminado.",
            ephemeral: true,
          });
        }

        if (sub === "ver") {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  0x5865f2
                )
                .setTitle(
                  "⚙️ Configuración"
                )
                .addFields(
                  {
                    name:
                      "🛡️ Staff",
                    value:
                      config.staffRole
                        ? `<@&${config.staffRole}>`
                        : "No configurado",
                  },
                  {
                    name:
                      "📁 Categoría de tickets",
                    value:
                      config.ticketCategory
                        ? `<#${config.ticketCategory}>`
                        : "No configurada",
                  },
                  {
                    name:
                      "⭐ Logs valoración",
                    value:
                      config.ratingLogs
                        ? `<#${config.ratingLogs}>`
                        : "No configurados",
                  },
                  {
                    name:
                      "📜 Logs cierres",
                    value:
                      config.transactionLogs
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

      // ================================================
      // LOGS
      // ================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "logs"
      ) {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo administradores.",
            ephemeral: true,
          });
        }

        const config =
          getGuildConfig(
            interaction.guild.id
          );

        const sub =
          interaction.options.getSubcommand();

        const channel =
          interaction.options.getChannel(
            "canal"
          );

        if (
          sub === "valoracion"
        ) {
          config.ratingLogs =
            channel.id;
        }

        if (
          sub ===
          "transacciones"
        ) {
          config.transactionLogs =
            channel.id;
        }

        saveDB();

        return interaction.reply({
          content:
            `✅ Logs configurados en ${channel}.`,
          ephemeral: true,
        });
      }

      // ================================================
      // CERRAR TICKET
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          "close_ticket"
      ) {
        const ticket =
          getTicket(
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Este ticket no está registrado.",
            ephemeral: true,
          });
        }

        if (!isStaff(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo el equipo de soporte puede cerrar tickets.",
            ephemeral: true,
          });
        }

        if (!ticket.claimedBy) {
          return interaction.reply({
            content:
              "❌ Primero debes reclamar el ticket.",
            ephemeral: true,
          });
        }

        if (
          ticket.claimedBy !==
            interaction.user.id &&
          !isAdmin(interaction)
        ) {
          return interaction.reply({
            content:
              `❌ Este ticket está siendo atendido por <@${ticket.claimedBy}>.`,
            ephemeral: true,
          });
        }

        // --------------------------------------------
        // VALORAR
        // --------------------------------------------

        if (
          ticket.status ===
          "claimed"
        ) {
          ticket.status =
            "rating";

          saveDB();

          const ratingEmbed =
            new EmbedBuilder()
              .setColor(
                0xfee75c
              )
              .setTitle(
                "⭐ Valorar atención"
              )
              .setDescription(
                [
                  `<@${ticket.ownerId}>, antes de finalizar tu solicitud queremos conocer tu experiencia.`,
                  "",
                  `🛡️ **Atendido por:** <@${ticket.claimedBy}>`,
                  "",
                  "Selecciona la cantidad de estrellas que deseas otorgar.",
                  "",
                  "⭐ **1** — Muy mala",
                  "⭐⭐ **2** — Mala",
                  "⭐⭐⭐ **3** — Regular",
                  "⭐⭐⭐⭐ **4** — Buena",
                  "⭐⭐⭐⭐⭐ **5** — Excelente",
                  "",
                  "Tu valoración quedará registrada en el sistema.",
                ].join("\n")
              )
              .setFooter({
                text:
                  "Sistema de Soporte • Valoraciones",
              })
              .setTimestamp();

          const row =
            new ActionRowBuilder().addComponents(
              ...[1, 2, 3, 4, 5].map(
                number =>
                  new ButtonBuilder()
                    .setCustomId(
                      `rating_${interaction.channel.id}_${number}`
                    )
                    .setLabel(
                      `${number}`
                    )
                    .setEmoji(
                      "⭐"
                    )
                    .setStyle(
                      number === 5
                        ? ButtonStyle.Success
                        : ButtonStyle.Primary
                    )
              )
            );

          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  0x5865f2
                )
                .setTitle(
                  "🔒 Cierre iniciado"
                )
                .setDescription(
                  "El usuario debe valorar la atención antes de continuar."
                )
                .setTimestamp(),
            ],
          });

          return interaction.channel.send(
            {
              content:
                `<@${ticket.ownerId}>`,
              embeds: [
                ratingEmbed,
              ],
              components: [
                row,
              ],
            }
          );
        }

        // --------------------------------------------
        // MOTIVO
        // --------------------------------------------

        if (
          ticket.status ===
          "rating"
        ) {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  0xfee75c
                )
                .setTitle(
                  "⭐ Valorar"
                )
                .setDescription(
                  `<@${ticket.ownerId}> todavía debe valorar la atención.`
                )
                .setTimestamp(),
            ],
            ephemeral: true,
          });
        }

        if (
          ticket.status ===
          "reason"
        ) {
          const modal =
            new ModalBuilder()
              .setCustomId(
                `close_reason_${interaction.channel.id}`
              )
              .setTitle(
                "Motivo de cierre"
              );

          const input =
            new TextInputBuilder()
              .setCustomId(
                "close_reason"
              )
              .setLabel(
                "Motivo de cierre"
              )
              .setPlaceholder(
                "Escribe por qué se está cerrando el ticket..."
              )
              .setStyle(
                TextInputStyle.Paragraph
              )
              .setRequired(true)
              .setMaxLength(500);

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              input
            )
          );

          return interaction.showModal(
            modal
          );
        }

        // --------------------------------------------
        // CERRAR
        // --------------------------------------------

        if (
          ticket.status ===
          "confirm"
        ) {
          ticket.status =
            "closing";

          saveDB();

          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(
                  0xed4245
                )
                .setTitle(
                  "🔒 Cerrar ticket"
                )
                .setDescription(
                  [
                    "La solicitud ha sido finalizada correctamente.",
                    "",
                    `👤 **Usuario:** <@${ticket.ownerId}>`,
                    `🛡️ **Atendido por:** <@${ticket.claimedBy}>`,
                    `⭐ **Valoración:** ${ticket.rating}/5`,
                    "",
                    "📝 **Motivo de cierre**",
                    ticket.closeReason ||
                      "Sin especificar.",
                    "",
                    "⏳ Este ticket será eliminado en **5 segundos**.",
                    "",
                    "La transcripción se guardará antes de eliminar el canal.",
                  ].join("\n")
                )
                .setTimestamp(),
            ],
          });

          const transcript =
            await createTranscript(
              interaction.channel,
              ticket
            );

          const attachment =
            new AttachmentBuilder(
              transcript,
              {
                name:
                  `transcript-${interaction.channel.name}.txt`,
              }
            );

          const config =
            getGuildConfig(
              interaction.guild.id
            );

          // LOG CIERRE
          if (
            config.transactionLogs
          ) {
            const log =
              interaction.guild.channels.cache.get(
                config.transactionLogs
              );

            if (log) {
              await log.send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(
                      0xed4245
                    )
                    .setTitle(
                      "📜 Ticket cerrado"
                    )
                    .addFields(
                      {
                        name:
                          "👤 Usuario",
                        value:
                          `<@${ticket.ownerId}>`,
                        inline: true,
                      },
                      {
                        name:
                          "🛡️ Staff",
                        value:
                          `<@${ticket.claimedBy}>`,
                        inline: true,
                      },
                      {
                        name:
                          "⭐ Valoración",
                        value:
                          `${ticket.rating}/5`,
                        inline: true,
                      },
                      {
                        name:
                          "📝 Motivo",
                        value:
                          ticket.closeReason ||
                          "Sin especificar.",
                      }
                    )
                    .setTimestamp(),
                ],
                files: [
                  attachment,
                ],
              }).catch(() => {});
            }
          }

          // MD
          const owner =
            await interaction.guild.members
              .fetch(
                ticket.ownerId
              )
              .catch(
                () => null
              );

          if (owner) {
            await owner
              .send({
                embeds: [
                  new EmbedBuilder()
                    .setColor(
                      0x5865f2
                    )
                    .setTitle(
                      "🔒 Ticket cerrado"
                    )
                    .setDescription(
                      [
                        `Tu solicitud en **${interaction.guild.name}** ha sido cerrada.`,
                        "",
                        `🛡️ **Atendido por:** <@${ticket.claimedBy}>`,
                        `⭐ **Valoración:** ${ticket.rating}/5`,
                        "",
                        "📝 **Motivo**",
                        ticket.closeReason ||
                          "Sin especificar.",
                        "",
                        "Gracias por utilizar nuestro sistema de soporte.",
                      ].join("\n")
                    )
                    .setTimestamp(),
                ],
              })
              .catch(() => {});
          }

          config.stats.closed++;

          const stats =
            staffStats(
              interaction.guild.id,
              ticket.claimedBy
            );

          stats.closed++;

          saveDB();

          const channel =
            interaction.channel;

          setTimeout(
            async () => {
              delete db.tickets[
                channel.id
              ];

              saveDB();

              await channel
                .delete(
                  "Ticket cerrado"
                )
                .catch(
                  () => {}
                );
            },
            5000
          );

          return;
        }
      }

      // ================================================
      // VALORACIÓN
      // ================================================

      if (
        interaction.isButton() &&
        interaction.customId.startsWith(
          "rating_"
        )
      ) {
        const parts =
          interaction.customId.split(
            "_"
          );

        const channelId =
          parts[1];

        const stars =
          Number(parts[2]);

        const ticket =
          getTicket(channelId);

        if (
          !ticket ||
          ticket.status !==
            "rating"
        ) {
          return interaction.reply({
            content:
              "❌ Esta valoración ya no está disponible.",
            ephemeral: true,
          });
        }

        if (
          interaction.user.id !==
          ticket.ownerId
        ) {
          return interaction.reply({
            content:
              "❌ Solo el propietario puede valorar.",
            ephemeral: true,
          });
        }

        const modal =
          new ModalBuilder()
            .setCustomId(
              `rating_modal_${channelId}_${stars}`
            )
            .setTitle(
              `${stars}/5 estrellas`
            );

        const comment =
          new TextInputBuilder()
            .setCustomId(
              "comment"
            )
            .setLabel(
              "Comentario opcional"
            )
            .setPlaceholder(
              "Cuéntanos cómo fue tu experiencia..."
            )
            .setStyle(
              TextInputStyle.Paragraph
            )
            .setRequired(false)
            .setMaxLength(500);

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            comment
          )
        );

        return interaction.showModal(
          modal
        );
      }

      // ================================================
      // GUARDAR VALORACIÓN
      // ================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          "rating_modal_"
        )
      ) {
        const parts =
          interaction.customId.split(
            "_"
          );

        const channelId =
          parts[2];

        const stars =
          Number(parts[3]);

        const ticket =
          getTicket(channelId);

        if (
          !ticket ||
          ticket.status !==
            "rating"
        ) {
          return interaction.reply({
            content:
              "❌ Esta valoración ya no está disponible.",
            ephemeral: true,
          });
        }

        if (
          interaction.user.id !==
          ticket.ownerId
        ) {
          return interaction.reply({
            content:
              "❌ No puedes valorar este ticket.",
            ephemeral: true,
          });
        }

        const comment =
          interaction.fields
            .getTextInputValue(
              "comment"
            )
            .trim() ||
          "Sin comentario.";

        ticket.rating =
          stars;

        ticket.ratingComment =
          comment;

        ticket.status =
          "reason";

        const config =
          getGuildConfig(
            interaction.guild.id
          );

        config.stats.ratings.push(
          stars
        );

        const stats =
          staffStats(
            interaction.guild.id,
            ticket.claimedBy
          );

        stats.ratings.push(
          stars
        );

        saveDB();

        // LOG VALORACIÓN
        if (
          config.ratingLogs
        ) {
          const log =
            interaction.guild.channels.cache.get(
              config.ratingLogs
            );

          if (log) {
            await log.send({
              embeds: [
                new EmbedBuilder()
                  .setColor(
                    0xfee75c
                  )
                  .setTitle(
                    "⭐ Nueva valoración"
                  )
                  .setDescription(
                    [
                      `${"⭐".repeat(
                        stars
                      )}${"☆".repeat(
                        5 - stars
                      )}`,
                      "",
                      `**${stars}/5 estrellas**`,
                    ].join("\n")
                  )
                  .addFields(
                    {
                      name:
                        "👤 Usuario",
                      value:
                        `<@${ticket.ownerId}>`,
                      inline: true,
                    },
                    {
                      name:
                        "🛡️ Staff",
                      value:
                        `<@${ticket.claimedBy}>`,
                      inline: true,
                    },
                    {
                      name:
                        "💬 Comentario",
                      value:
                        comment,
                    }
                  )
                  .setTimestamp(),
              ],
            }).catch(() => {});
          }
        }

        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0x57f287
              )
              .setTitle(
                "⭐ Valoración registrada"
              )
              .setDescription(
                [
                  `Has dado **${stars}/5 estrellas**.`,
                  "",
                  "Gracias por compartir tu experiencia.",
                  "",
                  "La valoración ha sido registrada correctamente.",
                ].join("\n")
              )
              .setTimestamp(),
          ],
        });

        return interaction.channel.send({
          content:
            `<@${ticket.claimedBy}>`,
          embeds: [
            new EmbedBuilder()
              .setColor(
                0x5865f2
              )
              .setTitle(
                "📝 Motivo de cierre"
              )
              .setDescription(
                [
                  "La valoración ya fue registrada.",
                  "",
                  `El responsable <@${ticket.claimedBy}> debe pulsar nuevamente **Cerrar ticket**.`,
                  "",
                  "Ahí podrá escribir el motivo por el que se finaliza la solicitud.",
                ].join("\n")
              )
              .setTimestamp(),
          ],
        });
      }

      // ================================================
      // MOTIVO DE CIERRE
      // ================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          "close_reason_"
        )
      ) {
        const channelId =
          interaction.customId.replace(
            "close_reason_",
            ""
          );

        const ticket =
          getTicket(channelId);

        if (
          !ticket ||
          ticket.status !==
            "reason"
        ) {
          return interaction.reply({
            content:
              "❌ Este ticket no está esperando un motivo.",
            ephemeral: true,
          });
        }

        if (
          ticket.claimedBy !==
            interaction.user.id &&
          !isAdmin(interaction)
        ) {
          return interaction.reply({
            content:
              "❌ Solo el responsable puede realizar esta acción.",
            ephemeral: true,
          });
        }

        const reason =
          interaction.fields.getTextInputValue(
            "close_reason"
          );

        ticket.closeReason =
          reason;

        ticket.status =
          "confirm";

        saveDB();

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(
                0xfee75c
              )
              .setTitle(
                "🔒 Cerrar"
              )
              .setDescription(
                [
                  "El motivo de cierre ha sido registrado.",
                  "",
                  "📝 **Motivo**",
                  reason,
                  "",
                  "Cuando estés listo, pulsa nuevamente **Cerrar ticket** para finalizarlo.",
                ].join("\n")
              )
              .setTimestamp(),
          ],
        });
      }
    } catch (error) {
      console.error(
        "❌ Error:",
        error
      );

      try {
        if (
          !interaction.replied &&
          !interaction.deferred
        ) {
          await interaction.reply({
            content:
              "❌ Ocurrió un error procesando esta acción.",
            ephemeral: true,
          });
        }
      } catch {}
    }
  }
);

// ======================================================
// HTTP PARA HOSTING
// ======================================================

const PORT =
  process.env.PORT || 3000;

http
  .createServer(
    (req, res) => {
      res.writeHead(
        200,
        {
          "Content-Type":
            "text/plain; charset=utf-8",
        }
      );

      res.end(
        "Sistema de tickets online."
      );
    }
  )
  .listen(
    PORT,
    () => {
      console.log(
        `🌐 HTTP activo en puerto ${PORT}`
      );
    }
  );

// ======================================================
// ERRORES
// ======================================================

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "❌ Unhandled Rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "❌ Uncaught Exception:",
      error
    );
  }
);

// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);
