import { SlashCommandBuilder } from 'discord.js';
import { EVENT_TYPE_LABELS } from '../../config/constants.js';
import { buildCv2NoticePayload } from '../../ui/componentsV2.js';
import { safeReplyV2 } from '../../ui/interactionHelpers.js';
import { THEME } from '../../ui/theme.js';
import { formatVnd } from '../../utils/format.js';

export const eventCommand = {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Xem các Sự kiện Đua Top & Giải thưởng đang diễn ra trên máy chủ (Components V2)')
    .addSubcommand((s) =>
      s.setName('list').setDescription('Xem danh sách các sự kiện đang mở')
    )
    .addSubcommand((s) =>
      s
        .setName('leaderboard')
        .setDescription('Xem bảng xếp hạng điểm của một sự kiện cụ thể')
        .addIntegerOption((o) =>
          o.setName('event_id').setDescription('Mã ID sự kiện').setRequired(true)
        )
    ),

  async execute(interaction, { eventSystem }) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const list = eventSystem.getActiveEvents();
      const lines =
        list.length > 0
          ? list.map((ev) => {
              const endUnix = Math.floor(ev.ends_at / 1000);
              return (
                `🎉 **#${ev.id} — ${ev.name}** (${EVENT_TYPE_LABELS[ev.type] || ev.type})\n` +
                `  ↳ ${ev.description}\n` +
                `  ↳ Giải Top 1: **${formatVnd(ev.reward_vnd)}** • Kết thúc: <t:${endUnix}:R>`
              );
            })
          : ['*Hiện chưa có sự kiện nào đang mở. Hãy đón chờ thông báo từ Admin nhé!*'];

      await safeReplyV2(
        interaction,
        buildCv2NoticePayload({
          title: '🎊 Sự Kiện Server Đang Diễn Ra',
          body: lines.join('\n\n'),
          accentColor: THEME.NEON_GOLD,
        })
      );
      return;
    }

    const eventId = interaction.options.getInteger('event_id', true);
    const ev = eventSystem.getEventById(eventId);
    if (!ev) {
      throw new Error(`Không tìm thấy sự kiện mã #${eventId}.`);
    }

    const board = eventSystem.getEventLeaderboard(eventId, 10);
    const lines =
      board.length > 0
        ? board.map(
            (r, i) => `\`#${i + 1}\` <@${r.user_id}> — **${r.score.toLocaleString('vi-VN')} điểm**`
          )
        : ['*Chưa có người chơi nào ghi điểm ở sự kiện này.*'];

    await safeReplyV2(
      interaction,
      buildCv2NoticePayload({
        title: `🏆 Bảng Xếp Hạng Sự Kiện #${ev.id}: ${ev.name}`,
        body:
          `Trạng thái: **${ev.status === 'active' ? '🟢 Đang diễn ra' : '🏁 Đã kết thúc'}** | Giải Top 1: **${formatVnd(ev.reward_vnd)}**\n\n` +
          lines.join('\n'),
        accentColor: THEME.NEON_CYAN,
      })
    );
  },
};

export const EVENT_COMMANDS = [eventCommand];
