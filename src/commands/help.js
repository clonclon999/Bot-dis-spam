import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { DEFAULT_GUILD_CONFIG, ESCALATION_LADDER } from '../config/defaults.js';
import { COLORS } from '../utils/embeds.js';
import { canManageAntiSpam } from '../utils/permissions.js';

export const helpCommand = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Xem hướng dẫn sử dụng, danh sách lệnh và quy tắc chống spam của Bot')
    .addStringOption((opt) =>
      opt
        .setName('topic')
        .setDescription('Chủ đề hướng dẫn muốn xem chi tiết')
        .setRequired(false)
        .addChoices(
          { name: '📘 Tổng quan nhanh (overview)', value: 'overview' },
          { name: '🛠️ Chi tiết tất cả lệnh (commands)', value: 'commands' },
          { name: '⚖️ Quy tắc phát hiện & Thang xử phạt (rules)', value: 'rules' }
        )
    )
    .addBooleanOption((opt) =>
      opt
        .setName('public')
        .setDescription('Hiển thị bảng hướng dẫn công khai ra kênh chat (chỉ dành cho Admin/Mod)')
        .setRequired(false)
    ),

  /**
   * Thực thi lệnh `/help`.
   * - Mặc định luôn phản hồi ẩn (Ephemeral) để tránh làm trôi kênh chat.
   * - Chỉ cho phép gửi công khai (`public: true`) nếu người gọi là Admin / Moderator.
   *
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {object} context
   * @param {import('../storage/guildStore.js').GuildStore} context.guildStore
   */
  async execute(interaction, { guildStore }) {
    const topic = interaction.options.getString('topic') ?? 'overview';
    const wantPublic = interaction.options.getBoolean('public') ?? false;
    const isStaff =
      interaction.inGuild() && canManageAntiSpam(interaction.member, true);

    const isEphemeral = !(wantPublic && isStaff);

    const guildConfig =
      interaction.inGuild() && interaction.guildId && guildStore
        ? guildStore.getConfig(interaction.guildId)
        : DEFAULT_GUILD_CONFIG;

    let embed;
    if (topic === 'commands') {
      embed = buildCommandsHelpEmbed();
    } else if (topic === 'rules') {
      embed = buildRulesHelpEmbed(guildConfig);
    } else {
      embed = buildOverviewHelpEmbed(interaction.guild, guildConfig);
    }

    const replyOptions = { embeds: [embed] };
    if (isEphemeral) {
      replyOptions.flags = MessageFlags.Ephemeral;
    }

    await interaction.reply(replyOptions);
  },
};

function buildOverviewHelpEmbed(guild, cfg) {
  const statusLine = guild
    ? `Máy chủ **${guild.name}**: ${cfg.enabled ? '🟢 **Đang bật bảo vệ**' : '🔴 **Đang tạm tắt**'}`
    : 'Hệ thống bảo vệ tự động cho máy chủ Discord';

  return new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle('📘 Hướng dẫn Sử dụng — Anti-Spam @Mention Bot')
    .setDescription(
      `${statusLine}\n` +
        'Bot tự động phát hiện và ngăn chặn hành vi spam `@everyone`, `@here`, mention hàng loạt và nháy tag quấy rối mà không bắt nhầm hội thoại bình thường.'
    )
    .addFields(
      {
        name: '📌 Ngưỡng giới hạn đang áp dụng',
        value: [
          `• Tối đa / 1 tin nhắn: **${cfg.maxMentionsPerMessage}** mention`,
          `• Tối đa dồn dập: **${cfg.maxMentionsWindow}** mention / **${cfg.timeWindowSeconds}s**`,
          `• Nháy lặp cùng 1 người: tối đa **${cfg.maxSameTargetMessages}** tin / **${cfg.repeatWindowSeconds}s**`,
          `• Chặn \`@everyone\` / \`@here\`: **${cfg.blockEveryoneHere ? 'Bật' : 'Tắt'}**`,
        ].join('\n'),
        inline: false,
      },
      {
        name: '🛠️ Các lệnh chính',
        value: [
          '• `/help [topic]` — Xem hướng dẫn tổng quan, chi tiết lệnh hoặc quy tắc xử phạt',
          '• `/antispam status` — Xem trạng thái bảo vệ, kiểm tra quyền Bot & RAM/Ping',
          '• `/antispam on` / `/antispam off` — Bật hoặc tắt hệ thống chống spam',
          '• `/antispam config` — Điều chỉnh giới hạn mention, thời gian & kênh Log',
          '• `/antispam whitelist` — Quản lý miễn trừ cho Vai trò, Thành viên, Kênh',
          '• `/antispam logs` — Tra cứu lịch sử vi phạm & đặt lại mức phạt',
          '• `/antispam reset` — Đặt lại cấu hình về mặc định',
        ].join('\n'),
        inline: false,
      },
      {
        name: '💡 Mẹo tra cứu nhanh',
        value:
          'Gõ `/help topic:Chi tiết tất cả lệnh` hoặc `/help topic:Quy tắc phát hiện & Thang xử phạt` để xem hướng dẫn chuyên sâu.',
        inline: false,
      }
    )
    .setFooter({ text: 'Anti-Spam @Mention System • An toàn & Tối ưu hiệu năng' })
    .setTimestamp();
}

function buildCommandsHelpEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle('🛠️ Danh sách Chi tiết Các Slash Commands')
    .setDescription(
      'Các lệnh cấu hình yêu cầu quyền **Manage Server** hoặc **Administrator**. Lệnh `/help` mở cho mọi thành viên.'
    )
    .addFields(
      {
        name: '1️⃣ `/help [topic] [public]`',
        value:
          'Xem hướng dẫn sử dụng. Mặc định chỉ hiển thị riêng cho bạn; Quản trị viên có thể bật `public: True` để ghim ra kênh.',
      },
      {
        name: '2️⃣ `/antispam on [log_channel]` & `/antispam off`',
        value:
          'Kích hoạt hoặc tạm dừng hệ thống chống spam. Có thể chọn luôn `log_channel` ngay khi bật.',
      },
      {
        name: '3️⃣ `/antispam config [...]`',
        value:
          'Tùy chỉnh `max_mentions_msg`, `max_mentions_window`, `time_window`, `max_repeat_messages`, `max_same_target`, `block_everyone`, `log_channel`, `strike_reset_minutes`, `auto_delete_warn_sec`. Bỏ trống tham số để xem cấu hình hiện tại.',
      },
      {
        name: '4️⃣ `/antispam whitelist action:<list|add|remove|clear>`',
        value:
          'Thêm hoặc gỡ **Role**, **User** hoặc **Channel** khỏi diện kiểm duyệt chống spam. *(Owner, Admin và Mod luôn được miễn trừ tự động).*',
      },
      {
        name: '5️⃣ `/antispam logs [user] [limit] [reset_strikes]`',
        value:
          'Xem nhật ký các vụ vi phạm gần nhất. Chọn `user` kèm `reset_strikes: True` để xóa mức cảnh cáo hiện hành cho thành viên đó.',
      },
      {
        name: '6️⃣ `/antispam status` & `/antispam reset [keep_logs]`',
        value:
          '`status` kiểm tra quyền Discord của Bot và thông số RAM/Uptime; `reset` khôi phục cấu hình gốc (mặc định vẫn giữ lịch sử log).',
      }
    )
    .setFooter({ text: 'Dùng dấu Tab sau khi gõ lệnh để chọn nhanh các tham số' })
    .setTimestamp();
}

function buildRulesHelpEmbed(cfg) {
  const ladderText = ESCALATION_LADDER.map((step) => `• **${step.label}**`).join('\n');

  return new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle('⚖️ Quy tắc Phát hiện & Cơ chế Xử phạt Tự động')
    .addFields(
      {
        name: '🚨 5 Hành vi bị chặn tự động',
        value: [
          '1. Sử dụng `@everyone` hoặc `@here` trái phép.',
          `2. Tag vượt quá **${cfg.maxMentionsPerMessage}** lượt trong cùng 1 tin nhắn (tính cả lặp 1 người).`,
          `3. Tag dồn dập vượt **${cfg.maxMentionsWindow}** lượt trong vòng **${cfg.timeWindowSeconds} giây**.`,
          `4. Nháy tag lặp lại cùng 1 người quá **${cfg.maxSameTargetMessages}** tin nhắn liên tiếp.`,
          `5. Gửi liên tiếp quá **${cfg.maxRepeatMessages}** tin nhắn chứa mention hoặc sửa tin nhắn cũ thành hàng loạt mention.`,
        ].join('\n'),
      },
      {
        name: '📈 Thang xử phạt lũy tiến',
        value:
          `${ladderText}\n` +
          `*(Lưu ý: Hành vi raid \`@everyone\`/\`@here\` hoặc gấp đôi ngưỡng cho phép sẽ bị áp dụng tối thiểu Mức 2 ngay lập tức. Mức phạt tự xóa sau **${cfg.strikeResetMinutes} phút** không tái phạm).*`,
      },
      {
        name: '🛡️ Cơ chế tránh phạt nhầm',
        value: [
          '• Trả lời tin nhắn bằng nút **Reply** của Discord không bị tính là spam mention.',
          '• Văn bản nằm trong cặp dấu code (`` `@everyone` ``) và email không bị bắt nhầm.',
          '• Owner, Admin, Moderator và danh sách Whitelist được miễn trừ hoàn toàn.',
        ].join('\n'),
      }
    )
    .setTimestamp();
}
