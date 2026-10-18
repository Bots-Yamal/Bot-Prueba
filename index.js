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

// ======================================================
// BASE DE DATOS
// ======================================================

const DB_FILE = "./database.json";

function defaultDatabase() {
  return {
    guilds: {},
    tickets: {},
  };
}

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const data = defaultDatabase();

    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(data, null, 2)
    );

    return data;
  }

  try {
    const data = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    if (!data.guilds) data.guilds = {};
    if (!data.tickets) data.tickets = {};

    return data;
  } catch (error) {
    console.error(
      "❌ Error leyendo database.json:",
      error
    );

    return defaultDatabase();
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

// ======================================================
// UTILIDADES
// ======================================================

function cleanName(name) {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "ticket"
  );
}

function isAdmin(interaction) {
  return interaction.member.permissions.has(
    PermissionFlagsBits.Administrator
  );
}

async function safeReply(interaction, options) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp(options);
    }

    return await interaction.reply(options);
  } catch (error) {
    console.error(
      "❌ Error respondiendo interacción:",
      error
    );
  }
}

const CATEGORY_INFO = {
  soporte: {
    name: "Soporte General",
    emoji: "📩",
    question: "¿En qué podemos ayudarte?",
    placeholder:
      "Explícanos detalladamente el problema o la duda que tienes...",
  },

  compras: {
    name: "Compras / Transacciones",
    emoji: "💳",
    question: "¿Qué problema tienes con tu compra?",
    placeholder:
      "Explícanos qué ocurrió con tu compra o transacción...",
  },

  alianzas: {
    name: "Alianzas",
    emoji: "🤝",
    question: "¿Cuál es tu propuesta?",
    placeholder:
      "Cuéntanos sobre tu servidor, proyecto o propuesta de colaboración...",
  },
};

// ======================================================
// TRANSCRIPCIÓN
// ======================================================

async function createTranscript(channel) {
  try {
    let allMessages = [];
    let before;

    while (true) {
      const options = {
        limit: 100,
      };

      if (before) {
        options.before = before;
      }

      const messages =
        await channel.messages.fetch(options);

      if (!messages.size) break;

      allMessages.push(...messages.values());

      before = messages.last().id;

      if (messages.size < 100) break;

      // Evitamos archivos exageradamente grandes.
      if (allMessages.length >= 1000) break;
    }

    allMessages.sort(
      (a, b) => a.createdTimestamp - b.createdTimestamp
    );

    const lines = [
      "==================================================",
      "TRANSCRIPCIÓN DEL TICKET",
      "==================================================",
      `Servidor: ${channel.guild.name}`,
      `Canal: #${channel.name}`,
      `Fecha: ${new Date().toLocaleString()}`,
      "==================================================",
      "",
    ];

    for (const message of allMessages) {
      const date = new Date(
        message.createdTimestamp
      ).toLocaleString();

      let content =
        message.content || "[Sin contenido de texto]";

      lines.push(
        `[${date}] ${message.author.tag}: ${content}`
      );

      if (message.attachments.size > 0) {
        for (const attachment of message.attachments.values()) {
          lines.push(
            `   📎 Archivo adjunto: ${attachment.url}`
          );
        }
      }

      if (message.embeds.length > 0) {
        lines.push(
          `   [Mensaje contiene ${message.embeds.length} embed(s)]`
        );
      }

      lines.push("");
    }

    return Buffer.from(
      lines.join("\n"),
      "utf8"
    );
  } catch (error) {
    console.error(
      "❌ Error creando transcript:",
      error
    );

    return Buffer.from(
      "No se pudo generar correctamente la transcripción.",
      "utf8"
    );
  }
}

// ======================================================
// COMANDOS SLASH
// ======================================================

const commands = [
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Administración del sistema de tickets")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
    .addSubcommand(sub =>
      sub
        .setName("panel")
        .setDescription(
          "Publica el panel profesional de soporte"
        )
    ),

  new SlashCommandBuilder()
    .setName("logs")
    .setDescription(
      "Configura los registros del sistema"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )

    .addSubcommand(sub =>
      sub
        .setName("valoracion")
        .setDescription(
          "Configura el canal de valoraciones"
        )
        .addChannelOption(option =>
          option
            .setName("canal")
            .setDescription(
              "Canal donde se enviarán las valoraciones"
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName("transacciones")
        .setDescription(
          "Configura el canal de cierres y transcripciones"
        )
        .addChannelOption(option =>
          option
            .setName("canal")
            .setDescription(
              "Canal donde se enviarán los registros"
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("user")
    .setDescription(
      "Administra usuarios dentro del ticket"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )

    .addSubcommand(sub =>
      sub
        .setName("invite")
        .setDescription(
          "Invita un usuario al ticket"
        )
        .addUserOption(option =>
          option
            .setName("usuario")
            .setDescription(
              "Usuario que quieres añadir"
            )
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
            .setDescription(
              "Usuario que quieres retirar"
            )
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("rename")
    .setDescription(
      "Cambia el nombre del ticket"
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
    .addStringOption(option =>
      option
        .setName("nombre")
        .setDescription(
          "Nuevo nombre del ticket"
        )
        .setRequired(true)
        .setMaxLength(70)
    ),
].map(command => command.toJSON());

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {
  console.log(
    `✅ Bot de Prueba conectado como ${client.user.tag}`
  );

  client.user.setPresence({
    activities: [
      {
        name: "🎫 Centro de Soporte",
      },
    ],
    status: "online",
  });

  try {
    const rest = new REST({
      version: "10",
    }).setToken(TOKEN);

    await rest.put(
      Routes.applicationCommands(
        client.user.id
      ),
      {
        body: commands,
      }
    );

    console.log(
      "✅ Comandos slash registrados."
    );
  } catch (error) {
    console.error(
      "❌ Error registrando comandos:",
      error
    );
  }
});

// ======================================================
// INTERACCIONES
// ======================================================

client.on(
  "interactionCreate",
  async interaction => {
    try {
      // ==================================================
      // /ticket panel
      // ==================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "ticket"
      ) {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Este comando está reservado para administradores.",
            ephemeral: true,
          });
        }

        const subcommand =
          interaction.options.getSubcommand();

        if (subcommand === "panel") {
          const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(
              "🎫 CENTRO DE SOPORTE"
            )
            .setDescription(
              [
                "### ¿Necesitas ayuda?",
                "Nuestro equipo está disponible para atender tu solicitud.",
                "",
                "Selecciona en el menú inferior el departamento correspondiente.",
                "",
                "━━━━━━━━━━━━━━━━━━━━",
                "",
                "📩 **Soporte General**",
                "Problemas, dudas, reportes o asistencia general.",
                "",
                "💳 **Compras / Transacciones**",
                "Consultas relacionadas con compras, pagos o transacciones.",
                "",
                "🤝 **Alianzas**",
                "Propuestas de colaboración o alianzas.",
                "",
                "━━━━━━━━━━━━━━━━━━━━",
                "",
                "### 📌 Información",
                "• Explica claramente tu solicitud.",
                "• Adjunta pruebas cuando sean necesarias.",
                "• Evita abrir múltiples tickets.",
                "• El uso indebido del sistema puede ser sancionado.",
                "",
                "Selecciona una categoría para comenzar.",
              ].join("\n")
            )
            .setFooter({
              text:
                `${interaction.guild.name} • Sistema de Soporte`,
              iconURL:
                interaction.guild.iconURL() ||
                undefined,
            })
            .setTimestamp();

          const menu =
            new StringSelectMenuBuilder()
              .setCustomId("ticket_menu")
              .setPlaceholder(
                "📨 Selecciona un departamento"
              )
              .addOptions(
                {
                  label:
                    "Soporte General",
                  description:
                    "Dudas, problemas y asistencia",
                  value: "soporte",
                  emoji: "📩",
                },
                {
                  label:
                    "Compras / Transacciones",
                  description:
                    "Compras, pagos y transacciones",
                  value: "compras",
                  emoji: "💳",
                },
                {
                  label: "Alianzas",
                  description:
                    "Colaboraciones y propuestas",
                  value: "alianzas",
                  emoji: "🤝",
                }
              );

          const row =
            new ActionRowBuilder().addComponents(
              menu
            );

          await interaction.channel.send({
            embeds: [embed],
            components: [row],
          });

          return interaction.reply({
            content:
              "✅ Panel profesional de soporte publicado correctamente.",
            ephemeral: true,
          });
        }
      }

      // ==================================================
      // /logs
      // ==================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "logs"
      ) {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo los administradores pueden configurar los logs.",
            ephemeral: true,
          });
        }

        const subcommand =
          interaction.options.getSubcommand();

        const channel =
          interaction.options.getChannel(
            "canal"
          );

        const config =
          getGuildConfig(
            interaction.guild.id
          );

        if (
          subcommand === "valoracion"
        ) {
          config.ratingLogs =
            channel.id;

          saveDB();

          return interaction.reply({
            content:
              `✅ **Canal de valoraciones configurado**\n\n⭐ Las nuevas valoraciones se publicarán en ${channel}.`,
            ephemeral: true,
          });
        }

        if (
          subcommand ===
          "transacciones"
        ) {
          config.transactionLogs =
            channel.id;

          saveDB();

          return interaction.reply({
            content:
              `✅ **Canal de registros configurado**\n\n📁 Los cierres y transcripciones se enviarán a ${channel}.`,
            ephemeral: true,
          });
        }
      }

      // ==================================================
      // /user invite y remove
      // ==================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "user"
      ) {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo los administradores pueden utilizar este comando.",
            ephemeral: true,
          });
        }

        const ticket =
          db.tickets[
            interaction.channel.id
          ];

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Este comando solo puede utilizarse dentro de un ticket.",
            ephemeral: true,
          });
        }

        const subcommand =
          interaction.options.getSubcommand();

        const user =
          interaction.options.getUser(
            "usuario"
          );

        if (
          subcommand === "invite"
        ) {
          await interaction.channel
            .permissionOverwrites.edit(
              user.id,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
                AttachFiles: true,
                EmbedLinks: true,
              }
            );

          const embed =
            new EmbedBuilder()
              .setColor(0x57f287)
              .setDescription(
                `👤 ${user} ha sido añadido al ticket por ${interaction.user}.`
              )
              .setTimestamp();

          return interaction.reply({
            embeds: [embed],
          });
        }

        if (
          subcommand === "remove"
        ) {
          if (
            user.id ===
            ticket.ownerId
          ) {
            return interaction.reply({
              content:
                "❌ No puedes retirar al propietario original del ticket.",
              ephemeral: true,
            });
          }

          await interaction.channel
            .permissionOverwrites.edit(
              user.id,
              {
                ViewChannel: false,
              }
            );

          const embed =
            new EmbedBuilder()
              .setColor(0xed4245)
              .setDescription(
                `👤 ${user} ha sido retirado del ticket por ${interaction.user}.`
              )
              .setTimestamp();

          return interaction.reply({
            embeds: [embed],
          });
        }
      }

      // ==================================================
      // /rename
      // ==================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "rename"
      ) {
        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo los administradores pueden renombrar tickets.",
            ephemeral: true,
          });
        }

        const ticket =
          db.tickets[
            interaction.channel.id
          ];

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Este comando solo puede utilizarse dentro de un ticket.",
            ephemeral: true,
          });
        }

        const requestedName =
          interaction.options.getString(
            "nombre"
          );

        const newName =
          cleanName(requestedName);

        await interaction.channel.setName(
          newName
        );

        return interaction.reply({
          content:
            `✏️ Ticket renombrado a **#${newName}** por ${interaction.user}.`,
        });
      }

      // ==================================================
      // SELECCIONAR CATEGORÍA
      // ==================================================

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId ===
          "ticket_menu"
      ) {
        const category =
          interaction.values[0];

        const info =
          CATEGORY_INFO[category];

        if (!info) {
          return interaction.reply({
            content:
              "❌ Categoría inválida.",
            ephemeral: true,
          });
        }

        const existingTicket =
          Object.values(
            db.tickets
          ).find(
            ticket =>
              ticket.guildId ===
                interaction.guild.id &&
              ticket.ownerId ===
                interaction.user.id &&
              !ticket.closed
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
          }

          delete db.tickets[
            existingTicket.channelId
          ];

          saveDB();
        }

        const modal =
          new ModalBuilder()
            .setCustomId(
              `ticket_create_${category}`
            )
            .setTitle(
              `${info.emoji} ${info.name}`
            );

        const input =
          new TextInputBuilder()
            .setCustomId(
              "ticket_reason"
            )
            .setLabel(info.question)
            .setPlaceholder(
              info.placeholder
            )
            .setStyle(
              TextInputStyle.Paragraph
            )
            .setRequired(true)
            .setMinLength(5)
            .setMaxLength(1000);

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            input
          )
        );

        return interaction.showModal(
          modal
        );
      }

      // ==================================================
      // CREAR TICKET DESDE MODAL
      // ==================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          "ticket_create_"
        )
      ) {
        const category =
          interaction.customId.replace(
            "ticket_create_",
            ""
          );

        const info =
          CATEGORY_INFO[category];

        if (!info) {
          return interaction.reply({
            content:
              "❌ Categoría inválida.",
            ephemeral: true,
          });
        }

        const reason =
          interaction.fields.getTextInputValue(
            "ticket_reason"
          );

        const existingTicket =
          Object.values(
            db.tickets
          ).find(
            ticket =>
              ticket.guildId ===
                interaction.guild.id &&
              ticket.ownerId ===
                interaction.user.id &&
              !ticket.closed
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
          }
        }

        await interaction.deferReply({
          ephemeral: true,
        });

        const username =
          cleanName(
            interaction.user.username
          );

        let channelName =
          `ticket-${username}`;

        // Evitamos nombres duplicados.
        const sameName =
          interaction.guild.channels.cache.find(
            channel =>
              channel.name ===
              channelName
          );

        if (sameName) {
          channelName =
            `ticket-${username}-${Date.now()
              .toString()
              .slice(-4)}`;
        }

        const channel =
          await interaction.guild.channels.create(
            {
              name: channelName,

              type:
                ChannelType.GuildText,

              permissionOverwrites: [
                {
                  id:
                    interaction.guild.id,

                  deny: [
                    PermissionFlagsBits.ViewChannel,
                  ],
                },

                {
                  id:
                    interaction.user.id,

                  allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                  ],
                },
              ],
            }
          );

        db.tickets[channel.id] = {
          channelId: channel.id,
          guildId:
            interaction.guild.id,
          ownerId:
            interaction.user.id,
          claimedBy: null,
          category,
          reason,
          createdAt: Date.now(),
          closed: false,
        };

        saveDB();

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
              `${info.emoji} ${info.name}`
            )
            .setDescription(
              [
                `Bienvenido ${interaction.user}.`,
                "",
                "Tu solicitud ha sido registrada correctamente.",
                "Un miembro del equipo la atenderá en cuanto esté disponible.",
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
                "### 📌 Información",
                "Puedes proporcionar información adicional, capturas o archivos mientras esperas.",
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
                `${interaction.guild.name} • Centro de Soporte`,
              iconURL:
                interaction.guild.iconURL() ||
                undefined,
            })
            .setTimestamp();

        const claimButton =
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
            );

        const closeButton =
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
            );

        const row =
          new ActionRowBuilder().addComponents(
            claimButton,
            closeButton
          );

        await channel.send({
          content:
            `${interaction.user}`,
          embeds: [embed],
          components: [row],
        });

        return interaction.editReply({
          content:
            `✅ Tu ticket ha sido creado correctamente: ${channel}`,
        });
      }

      // ==================================================
      // RECLAMAR TICKET
      // ==================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          "claim_ticket"
      ) {
        const ticket =
          db.tickets[
            interaction.channel.id
          ];

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Este canal no está registrado como ticket.",
            ephemeral: true,
          });
        }

        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo los administradores pueden reclamar tickets.",
            ephemeral: true,
          });
        }

        if (ticket.claimedBy) {
          return interaction.reply({
            content:
              `❌ Este ticket ya está siendo atendido por <@${ticket.claimedBy}>.`,
            ephemeral: true,
          });
        }

        ticket.claimedBy =
          interaction.user.id;

        saveDB();

        const embed =
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle(
              "🙋 Ticket reclamado"
            )
            .setDescription(
              [
                `${interaction.user} se ha hecho responsable de esta solicitud.`,
                "",
                "A partir de este momento será el encargado de atender el ticket.",
              ].join("\n")
            )
            .setTimestamp();

        return interaction.reply({
          embeds: [embed],
        });
      }

      // ==================================================
      // BOTÓN CERRAR
      // ==================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          "close_ticket"
      ) {
        const ticket =
          db.tickets[
            interaction.channel.id
          ];

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Este canal no está registrado como ticket.",
            ephemeral: true,
          });
        }

        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Solo los administradores pueden cerrar tickets.",
            ephemeral: true,
          });
        }

        if (!ticket.claimedBy) {
          return interaction.reply({
            content:
              "❌ El ticket debe ser reclamado antes de cerrarlo.",
            ephemeral: true,
          });
        }

        const modal =
          new ModalBuilder()
            .setCustomId(
              `close_modal_${interaction.channel.id}`
            )
            .setTitle(
              "Cerrar ticket"
            );

        const reasonInput =
          new TextInputBuilder()
            .setCustomId(
              "close_reason"
            )
            .setLabel(
              "Razón del cierre"
            )
            .setPlaceholder(
              "Ejemplo: Problema solucionado correctamente."
            )
            .setStyle(
              TextInputStyle.Paragraph
            )
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(500);

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            reasonInput
          )
        );

        return interaction.showModal(
          modal
        );
      }

      // ==================================================
      // CONFIRMAR CIERRE
      // ==================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId.startsWith(
          "close_modal_"
        )
      ) {
        const channelId =
          interaction.customId.replace(
            "close_modal_",
            ""
          );

        const ticket =
          db.tickets[channelId];

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Este ticket ya no existe.",
            ephemeral: true,
          });
        }

        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ No tienes permisos para cerrar este ticket.",
            ephemeral: true,
          });
        }

        const closeReason =
          interaction.fields.getTextInputValue(
            "close_reason"
          );

        ticket.closeReason =
          closeReason;

        ticket.closedBy =
          interaction.user.id;

        ticket.closed = true;

        ticket.closedAt =
          Date.now();

        saveDB();

        await interaction.deferReply();

        const info =
          CATEGORY_INFO[
            ticket.category
          ] || {
            name: ticket.category,
            emoji: "🎫",
          };

        const transcriptBuffer =
          await createTranscript(
            interaction.channel
          );

        const transcript =
          new AttachmentBuilder(
            transcriptBuffer,
            {
              name:
                `transcript-${interaction.channel.name}.txt`,
            }
          );

        // ================================================
        // MD AL USUARIO
        // ================================================

        const owner =
          await interaction.guild.members
            .fetch(ticket.ownerId)
            .catch(() => null);

        if (owner) {
          const dmEmbed =
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle(
                "🔒 Tu ticket ha sido cerrado"
              )
              .setDescription(
                [
                  `Tu solicitud de soporte en **${interaction.guild.name}** ha sido cerrada.`,
                  "",
                  `### ${info.emoji} Categoría`,
                  info.name,
                  "",
                  "### 📋 Razón del cierre",
                  closeReason,
                  "",
                  "Si necesitas asistencia nuevamente, puedes abrir un nuevo ticket desde el panel de soporte.",
                ].join("\n")
              )
              .addFields({
                name:
                  "🛡️ Cerrado por",
                value:
                  `<@${interaction.user.id}>`,
                inline: true,
              })
              .setFooter({
                text:
                  `${interaction.guild.name} • Centro de Soporte`,
                iconURL:
                  interaction.guild.iconURL() ||
                  undefined,
              })
              .setTimestamp();

          await owner
            .send({
              embeds: [dmEmbed],
            })
            .catch(() => {});
        }

        // ================================================
        // LOG + TRANSCRIPT
        // ================================================

        const config =
          getGuildConfig(
            interaction.guild.id
          );

        if (
          config.transactionLogs
        ) {
          const logChannel =
            interaction.guild.channels.cache.get(
              config.transactionLogs
            );

          if (logChannel) {
            const logEmbed =
              new EmbedBuilder()
                .setColor(0xed4245)
                .setTitle(
                  "📁 Ticket cerrado"
                )
                .setDescription(
                  "Se ha cerrado una solicitud de soporte."
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
                      "🛡️ Atendido por",
                    value:
                      ticket.claimedBy
                        ? `<@${ticket.claimedBy}>`
                        : "Sin asignar",
                    inline: true,
                  },
                  {
                    name:
                      "🔒 Cerrado por",
                    value:
                      `<@${interaction.user.id}>`,
                    inline: true,
                  },
                  {
                    name:
                      "📂 Categoría",
                    value:
                      `${info.emoji} ${info.name}`,
                    inline: true,
                  },
                  {
                    name:
                      "📋 Razón",
                    value:
                      closeReason,
                  }
                )
                .setFooter({
                  text:
                    "📎 La transcripción está adjunta a este mensaje",
                })
                .setTimestamp();

            await logChannel
              .send({
                embeds: [logEmbed],
                files: [
                  transcript,
                ],
              })
              .catch(error =>
                console.error(
                  "Error enviando transcript:",
                  error
                )
              );
          }
        }

        // ================================================
        // VALORACIÓN DENTRO DEL TICKET
        // ================================================

        await interaction.channel
          .permissionOverwrites.edit(
            ticket.ownerId,
            {
              ViewChannel: true,
              SendMessages: false,
              ReadMessageHistory: true,
            }
          )
          .catch(() => {});

        const ratingEmbed =
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle(
              "⭐ Valora la atención recibida"
            )
            .setDescription(
              [
                `${interaction.user} ha cerrado esta solicitud.`,
                "",
                `**Razón:** ${closeReason}`,
                "",
                "Antes de finalizar, nos gustaría conocer tu experiencia.",
                "",
                "Selecciona una valoración de **1 a 5 estrellas**.",
                "",
                "Tu opinión nos ayuda a mejorar nuestro servicio.",
              ].join("\n")
            )
            .setFooter({
              text:
                "Sistema de Valoraciones",
            })
            .setTimestamp();

        const ratingRow =
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(
                `rating_${channelId}_1`
              )
              .setLabel("1")
              .setEmoji("⭐")
              .setStyle(
                ButtonStyle.Secondary
              ),

            new ButtonBuilder()
              .setCustomId(
                `rating_${channelId}_2`
              )
              .setLabel("2")
              .setEmoji("⭐")
              .setStyle(
                ButtonStyle.Secondary
              ),

            new ButtonBuilder()
              .setCustomId(
                `rating_${channelId}_3`
              )
              .setLabel("3")
              .setEmoji("⭐")
              .setStyle(
                ButtonStyle.Secondary
              ),

            new ButtonBuilder()
              .setCustomId(
                `rating_${channelId}_4`
              )
              .setLabel("4")
              .setEmoji("⭐")
              .setStyle(
                ButtonStyle.Primary
              ),

            new ButtonBuilder()
              .setCustomId(
                `rating_${channelId}_5`
              )
              .setLabel("5")
              .setEmoji("⭐")
              .setStyle(
                ButtonStyle.Success
              )
          );

        await interaction.editReply({
          content:
            `🔒 Ticket cerrado por ${interaction.user}.`,
        });

        await interaction.channel.send({
          content:
            `<@${ticket.ownerId}>`,
          embeds: [ratingEmbed],
          components: [ratingRow],
        });

        // 5 minutos para valorar.
        ticket.ratingExpiresAt =
          Date.now() +
          5 * 60 * 1000;

        saveDB();

        setTimeout(async () => {
          const current =
            db.tickets[channelId];

          if (
            current &&
            current.closed
          ) {
            delete db.tickets[
              channelId
            ];

            saveDB();

            const oldChannel =
              interaction.guild.channels.cache.get(
                channelId
              );

            if (oldChannel) {
              await oldChannel
                .delete(
                  "Ticket cerrado - valoración expirada"
                )
                .catch(() => {});
            }
          }
        }, 5 * 60 * 1000);

        return;
      }

      // ==================================================
      // BOTONES DE VALORACIÓN
      // ==================================================

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
          db.tickets[channelId];

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Esta solicitud de valoración ya expiró.",
            ephemeral: true,
          });
        }

        if (
          interaction.user.id !==
          ticket.ownerId
        ) {
          return interaction.reply({
            content:
              "❌ Solo el usuario que abrió el ticket puede valorarlo.",
            ephemeral: true,
          });
        }

        if (
          ticket.ratingExpiresAt &&
          Date.now() >
            ticket.ratingExpiresAt
        ) {
          return interaction.reply({
            content:
              "❌ El tiempo para valorar este ticket ha terminado.",
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

        const commentInput =
          new TextInputBuilder()
            .setCustomId(
              "comment"
            )
            .setLabel(
              "¿Qué te pareció la atención?"
            )
            .setPlaceholder(
              "Cuéntanos brevemente cómo fue tu experiencia..."
            )
            .setStyle(
              TextInputStyle.Paragraph
            )
            .setRequired(false)
            .setMaxLength(500);

        modal.addComponents(
          new ActionRowBuilder().addComponents(
            commentInput
          )
        );

        return interaction.showModal(
          modal
        );
      }

      // ==================================================
      // ENVIAR VALORACIÓN
      // ==================================================

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
          db.tickets[channelId];

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ Esta valoración ya expiró.",
            ephemeral: true,
          });
        }

        if (
          interaction.user.id !==
          ticket.ownerId
        ) {
          return interaction.reply({
            content:
              "❌ Esta valoración no te pertenece.",
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

        const guild =
          client.guilds.cache.get(
            ticket.guildId
          );

        if (!guild) {
          return interaction.reply({
            content:
              "❌ No pude encontrar el servidor.",
            ephemeral: true,
          });
        }

        const config =
          getGuildConfig(guild.id);

        const ratingChannel =
          config.ratingLogs
            ? guild.channels.cache.get(
                config.ratingLogs
              )
            : null;

        const starsText =
          "⭐".repeat(stars) +
          "☆".repeat(
            Math.max(0, 5 - stars)
          );

        const info =
          CATEGORY_INFO[
            ticket.category
          ] || {
            name:
              ticket.category,
            emoji: "🎫",
          };

        if (ratingChannel) {
          const ratingEmbed =
            new EmbedBuilder()
              .setColor(0xfee75c)
              .setTitle(
                "⭐ Nueva valoración"
              )
              .setDescription(
                `### ${starsText}\n**${stars}/5 estrellas**`
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
                    "🛡️ Atendido por",
                  value:
                    ticket.claimedBy
                      ? `<@${ticket.claimedBy}>`
                      : "Sin asignar",
                  inline: true,
                },
                {
                  name:
                    "📂 Categoría",
                  value:
                    `${info.emoji} ${info.name}`,
                  inline: true,
                },
                {
                  name:
                    "💬 Comentario",
                  value:
                    comment,
                },
                {
                  name:
                    "📋 Razón del cierre",
                  value:
                    ticket.closeReason ||
                    "No especificada.",
                }
              )
              .setFooter({
                text:
                  `${guild.name} • Valoraciones`,
                iconURL:
                  guild.iconURL() ||
                  undefined,
              })
              .setTimestamp();

          await ratingChannel
            .send({
              embeds: [
                ratingEmbed,
              ],
            })
            .catch(() => {});
        }

        await interaction.reply({
          content:
            `✅ **¡Gracias por tu valoración!**\n\n${starsText} **${stars}/5**`,
          ephemeral: true,
        });

        delete db.tickets[
          channelId
        ];

        saveDB();

        const ticketChannel =
          guild.channels.cache.get(
            channelId
          );

        if (ticketChannel) {
          await ticketChannel
            .send({
              embeds: [
                new EmbedBuilder()
                  .setColor(
                    0x57f287
                  )
                  .setDescription(
                    `✅ Valoración recibida: **${stars}/5 estrellas**.\n\nEste ticket se cerrará en unos segundos.`
                  ),
              ],
            })
            .catch(() => {});

          setTimeout(() => {
            ticketChannel
              .delete(
                "Ticket finalizado y valorado"
              )
              .catch(() => {});
          }, 5000);
        }

        return;
      }
    } catch (error) {
      console.error(
        "❌ Error en interactionCreate:",
        error
      );

      await safeReply(
        interaction,
        {
          content:
            "❌ Ocurrió un error procesando esta acción.",
          ephemeral: true,
        }
      );
    }
  }
);

// ======================================================
// SERVIDOR HTTP
// ======================================================

const PORT =
  process.env.PORT || 3000;

http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type":
        "text/plain; charset=utf-8",
    });

    res.end(
      "Bot de Prueba está online."
    );
  })
  .listen(PORT, () => {
    console.log(
      `🌐 Servidor HTTP activo en puerto ${PORT}`
    );
  });

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
