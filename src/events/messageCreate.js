import { PermissionsBitField } from 'discord.js';
import {
  buildChannelStartPayload,
  buildChannelWinAndNextPayload,
  buildInvalidWordPayload,
  buildLeaderboardPayload,
  buildStatsPayload,
  buildValidTurnPayload,
  buildVictoryPayload,
  capitalizeVi,
  cleanupRoomFeedbackMessage,
  editNoituBoardMessage,
} from '../commands/games/noitu.js';
import { BOT_ROLES, GAME_IDS } from '../config/constants.js';
import { evaluateExemption } from '../services/whitelistService.js';
import { buildCv2NoticePayload } from '../ui/componentsV2.js';
import { THEME } from '../ui/theme.js';
import { ConcurrencyGuard } from '../utils/locks.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_RESULT_TTL_MS, globalPanelCleaner } from '../utils/panelCleaner.js';
import { hasBotRole } from '../utils/permissions.js';

/** Bộ đệm thời gian nhận EXP trò chuyện để tránh ghi SQLite liên tục khi chat nhanh */
const chatExpCooldowns = new Map();
const CHAT_EXP_INTERVAL_MS = 60_000;

/** Khóa tuần tự theo từng phòng Nối Từ để chống 2 người gửi tin nhắn cùng 1 mili-giây gây đua Embed */
const noituRoomGuard = new ConcurrencyGuard();

/**
 * Xử lý sự kiện tin nhắn mới (`messageCreate`):
 * 1. Thực thi lớp bảo vệ Anti-Spam `@Mention` trước tiên.
 * 2. Xử lý lượt đấu Nối Từ Tiếng Việt PRO nếu tin nhắn nằm đúng trong kênh Nối Từ đã cài đặt.
 * 3. Cộng nhẹ EXP tương tác định kỳ (mỗi 60s/người).
 */
export async function handleMessageCreate(message, context) {
  const {
    guildStore,
    mentionDetector,
    punishmentService,
    db,
    economySystem,
    levelSystem,
    questSystem,
    wordChainSystem,
  } = context;

  try {
    if (!message || !message.guild || message.system) return;

    if (message.partial && typeof message.fetch === 'function') {
      message = await message.fetch().catch(() => null);
      if (!message || !message.guild) return;
    }

    // Bước 1: Kiểm tra Anti-Spam @Mention nếu máy chủ đang bật
    if (guildStore && mentionDetector && punishmentService) {
      const config = guildStore.getConfig(message.guild.id);
      if (config.enabled) {
        const botUserId = message.client?.user?.id ?? null;
        const exemption = evaluateExemption(message, config, botUserId);
        if (!exemption.exempt) {
          const violation = mentionDetector.inspectMessage(message, config);
          if (violation) {
            await punishmentService.enforce({ message, violation, config });
            return;
          }
        }
      }
    }

    if (message.author?.bot) return;

    // Bước 2: Xử lý Trò Chơi Nối Từ Tiếng Việt (Hỗ trợ cả Nhiều Người Toàn Kênh kiểu Neko lẫn 1v1)
    if (db && wordChainSystem && !db.getSetting('maintenanceMode') && wordChainSystem.isEnabled()) {
      const rawTrim = String(message.content ?? '').trim();
      const lowerCmd = rawTrim.toLowerCase();

      // Lệnh nhanh `nsetnoitu` / `!setnoitu` giống Neko để cài kênh Nối Từ trực tiếp tại kênh hiện tại
      if (lowerCmd === 'nsetnoitu' || lowerCmd === '!setnoitu') {
        const canSet =
          hasBotRole(db, message.author.id, BOT_ROLES.ADMIN) ||
          Boolean(
            message.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild) ||
              message.member?.permissions?.has?.(PermissionsBitField.Flags.ManageChannels)
          );
        if (!canSet) {
          const denied = await message.channel
            ?.send?.(
              buildCv2NoticePayload({
                title: '⛔ Không Đủ Quyền Cài Kênh',
                body: 'Bạn cần quyền Quản lý Máy chủ / Kênh hoặc quyền ADMIN để dùng `nsetnoitu`!',
                accentColor: THEME.CRIMSON_NEON,
              })
            )
            .catch(() => null);
          if (denied) globalPanelCleaner.scheduleAutoDelete(denied, 6_000);
          return;
        }

        db.setGameChannel(message.guild.id, GAME_IDS.NOITU, message.channel.id);
        const okMsg = await message.channel
          ?.send?.(
            buildCv2NoticePayload({
              title: '✅ Đã Cài Đặt Kênh Nối Từ Nhiều Người!',
              body:
                `Đã chọn <#${message.channel.id}> làm kênh **Nối Từ Tiếng Việt** của máy chủ.\n` +
                `👉 Gõ **\`start!\`** ngay trong kênh này để bắt đầu chơi nhiều người! *(Dùng \`stop!\` để đổi từ mới)*`,
              accentColor: THEME.CYBER_EMERALD,
            })
          )
          .catch(() => null);
        if (okMsg) globalPanelCleaner.scheduleAutoDelete(okMsg, DEFAULT_RESULT_TTL_MS);
        return;
      }

      const parentId = message.channel?.parentId ?? null;
      const isNoituChannel = db.isAllowedGameChannel(
        message.guild.id,
        GAME_IDS.NOITU,
        message.channel?.id,
        parentId
      );

      if (isNoituChannel) {
        const userRow = db.get('SELECT is_banned FROM users WHERE user_id = ?', [
          message.author.id,
        ]);
        if (userRow?.is_banned) return;

        // 2a. Các lệnh nhanh phong cách Neko ngay trong kênh #nối-từ (`start!`, `stop!`, `nrank`, `nme`)
        if (lowerCmd === 'start!' || lowerCmd === '!start') {
          await noituRoomGuard.runExclusive(`chan:${message.channel.id}`, async () => {
            const res = wordChainSystem.startChannelSession({
              guildId: message.guild.id,
              channelId: message.channel.id,
              actorId: message.author.id,
              actorName: message.author.username,
            });
            if (!res.ok && res.code === 'ALREADY_RUNNING') {
              const remind = await message.channel
                ?.send?.(
                  buildCv2NoticePayload({
                    title: `🟢 Trò Chơi Vẫn Đang Tiếp Tục (Ván #${res.session.roundNumber})`,
                    body:
                      `🎯 **Từ hiện tại:** **\`${res.session.currentWord}\`** ➔ Hãy nối tiếp bằng **\`${capitalizeVi(res.session.requiredPrefix)} ...\`**!\n` +
                      `*(Bạn có thể gõ \`stop!\` nếu muốn kết thúc và đổi sang từ mới)*`,
                    accentColor: THEME.NEON_CYAN,
                  })
                )
                .catch(() => null);
              if (remind) globalPanelCleaner.scheduleAutoDelete(remind, 8_000);
              return;
            }
            const sent = await message.channel
              ?.send?.(buildChannelStartPayload(res.session))
              .catch(() => null);
            if (sent) {
              await globalPanelCleaner.registerChannelBoard(
                message.channel.id,
                'noitu_chan_round',
                sent
              );
            }
          });
          return;
        }

        if (lowerCmd === 'stop!' || lowerCmd === '!stop') {
          const canForceStop =
            hasBotRole(db, message.author.id, BOT_ROLES.MOD) ||
            Boolean(
              message.member?.permissions?.has?.(PermissionsBitField.Flags.ManageChannels) ||
                message.member?.permissions?.has?.(PermissionsBitField.Flags.ManageGuild)
            );
          await noituRoomGuard.runExclusive(`chan:${message.channel.id}`, async () => {
            const res = wordChainSystem.stopChannelSessionAndRestart({
              guildId: message.guild.id,
              channelId: message.channel.id,
              actorId: message.author.id,
              actorName: message.author.username,
              canForceStop,
            });
            if (!res.ok) {
              const body =
                res.code === 'NOT_RUNNING'
                  ? 'Trò chơi chưa bắt đầu! Hãy gõ **`start!`** để mở ván mới.'
                  : `⏳ Ván đang diễn ra! Đợi thêm **${res.waitSec} giây** không ai nối được để đổi từ mới, hoặc nhờ Quản trị viên gõ \`stop!\`.`;
              const warn = await message.channel
                ?.send?.(
                  buildCv2NoticePayload({
                    title: '⚠️ Chưa Thể Đổi Từ Lúc Này',
                    body,
                    accentColor: THEME.AMBER_PULSE,
                  })
                )
                .catch(() => null);
              if (warn) globalPanelCleaner.scheduleAutoDelete(warn, 5_000);
              return;
            }
            const sent = await message.channel
              ?.send?.(
                buildChannelStartPayload(res.session, {
                  isRestart: true,
                  prevSession: res.previousSession,
                })
              )
              .catch(() => null);
            if (sent) {
              await globalPanelCleaner.registerChannelBoard(
                message.channel.id,
                'noitu_chan_round',
                sent
              );
            }
          });
          return;
        }

        if (lowerCmd === 'nrank' || lowerCmd === '!rank') {
          const boards = wordChainSystem.getLeaderboards(10);
          const sent = await message.channel
            ?.send?.(buildLeaderboardPayload(boards, 'all', false))
            .catch(() => null);
          if (sent) globalPanelCleaner.scheduleAutoDelete(sent, DEFAULT_RESULT_TTL_MS);
          return;
        }

        if (lowerCmd === 'nme' || lowerCmd === '!me') {
          const stats = wordChainSystem.getPlayerStats(
            message.author.id,
            message.author.username
          );
          const sent = await message.channel
            ?.send?.(buildStatsPayload(message.author, stats, false))
            .catch(() => null);
          if (sent) globalPanelCleaner.scheduleAutoDelete(sent, DEFAULT_RESULT_TTL_MS);
          return;
        }

        // 2b. Nếu người chơi đang thi đấu trong phòng 1v1 riêng thì ưu tiên xử lý phòng 1v1 đó
        const activeRoom = wordChainSystem.getPlayerActiveRoom(message.author.id);
        if (
          activeRoom &&
          activeRoom.status === 'playing' &&
          activeRoom.channelId === String(message.channel.id)
        ) {
          await noituRoomGuard.runExclusive(activeRoom.roomId, async () => {
            activeRoom.channelRef = message.channel;
            const turnResult = wordChainSystem.submitTurnMessage({
              guildId: message.guild.id,
              channelId: message.channel.id,
              userId: message.author.id,
              username: message.author.username,
              content: message.content,
            });

            if (turnResult) {
              await renderNoituProTurn(message, turnResult, wordChainSystem);
            }
          });
          return;
        }

        // 2c. Xử lý Nối Từ Nhiều Người Toàn Kênh (không giới hạn số người chơi!)
        const chanSession = wordChainSystem.getChannelSession(message.channel.id);
        if (chanSession?.running) {
          let handledInChannel = false;
          await noituRoomGuard.runExclusive(`chan:${message.channel.id}`, async () => {
            const wordRes = wordChainSystem.submitChannelWord({
              guildId: message.guild.id,
              channelId: message.channel.id,
              userId: message.author.id,
              username: message.author.username,
              content: message.content,
            });
            if (!wordRes) return;
            handledInChannel = true;

            if (!wordRes.ok) {
              await message.react?.('❌')?.catch(() => {});
              const hint = await message.channel
                ?.send?.(
                  buildCv2NoticePayload({
                    title: '❌ Chưa Hợp Lệ',
                    body: wordRes.message,
                    accentColor: THEME.CRIMSON_NEON,
                  })
                )
                .catch(() => null);
              if (hint) globalPanelCleaner.scheduleAutoDelete(hint, 4_000);
              return;
            }

            await message.react?.('✅')?.catch(() => {});
            if (wordRes.finished) {
              await message.react?.('🏆')?.catch(() => {});
              const winSent = await message.channel
                ?.send?.(buildChannelWinAndNextPayload(wordRes))
                .catch(() => null);
              if (winSent) {
                await globalPanelCleaner.registerChannelBoard(
                  message.channel.id,
                  'noitu_chan_round',
                  winSent
                );
              }
            }
          });
          if (handledInChannel) return;
        }
      }
    }

    // Bước 3: Thưởng EXP trò chuyện thụ động nhẹ nhàng (cooldown 60 giây)
    if (db && economySystem && levelSystem && !db.getSetting('maintenanceMode')) {
      const uid = message.author.id;
      const now = Date.now();
      const prev = chatExpCooldowns.get(uid) ?? 0;
      if (now - prev >= CHAT_EXP_INTERVAL_MS) {
        chatExpCooldowns.set(uid, now);
        if (chatExpCooldowns.size > 3000) {
          for (const [k, ts] of chatExpCooldowns.entries()) {
            if (now - ts > CHAT_EXP_INTERVAL_MS) chatExpCooldowns.delete(k);
          }
        }
        const u = economySystem.ensureUser(uid, message.author.username, now);
        if (!u.is_banned) {
          levelSystem.grantExp(uid, 12, now);
          questSystem?.incrementMetric(uid, 'messages_sent', 1, now);
        }
      }
    }
  } catch (err) {
    logger.error('MessageCreateEvent', 'Lỗi không mong muốn khi xử lý tin nhắn', err);
  }
}

/**
 * Hiển thị phản hồi từng lượt Nối Từ bằng Embed chuyên nghiệp và chỉnh sửa tại chỗ chống spam:
 * - Lượt đúng & tiếp diễn: Xóa cảnh báo lỗi cũ (nếu có) và CHỈNH SỬA trực tiếp Embed bàn đấu hiện tại (`🟢 NỐI TỪ – HỢP LỆ!`).
 * - Chiến thắng (hết từ nối tiếp / hết giờ): CHỈNH SỬA Embed bàn đấu sang `🏆 CHÚC MỪNG! BẠN ĐÃ CHIẾN THẮNG!`.
 * - Từ sai / từ đã dùng / sai lượt: Hiển thị Embed `🔴 TỪ KHÔNG HỢP LỆ!` hoặc `⚠️ TỪ ĐÃ ĐƯỢC SỬ DỤNG!` (tái sử dụng khung cảnh báo của phòng để không spam tin nhắn).
 */
async function renderNoituProTurn(message, turnResult, wordChainSystem) {
  const channel = message.channel;
  const room = turnResult.room;

  // Trường hợp trận đấu vừa kết thúc (do hết từ trong từ điển hoặc vừa chạm mốc hết giờ)
  if (turnResult.finished && turnResult.outcome) {
    await cleanupRoomFeedbackMessage(room);
    const victoryPayload = buildVictoryPayload(turnResult.outcome);

    if (room?.boardMessage && typeof room.boardMessage.edit === 'function') {
      const edited = await editNoituBoardMessage(room.boardMessage, victoryPayload);
      if (edited) {
        globalPanelCleaner.scheduleAutoDelete(room.boardMessage, DEFAULT_RESULT_TTL_MS);
        return;
      }
    }

    if (typeof channel?.send === 'function') {
      const sent = await channel.send(victoryPayload).catch(() => null);
      if (sent) {
        globalPanelCleaner.scheduleAutoDelete(sent, DEFAULT_RESULT_TTL_MS);
      }
    }
    return;
  }

  // Trường hợp trả lời sai / từ đã dùng / sai lượt -> Gửi hoặc chỉnh sửa tại chỗ khung cảnh báo Components V2
  if (!turnResult.ok) {
    const errPayload = buildInvalidWordPayload({
      authorId: message.author.id,
      code: turnResult.code,
      word: turnResult.word,
      requiredPrefix: turnResult.requiredPrefix,
      remainingSec: turnResult.remainingSec,
      currentTurnUserId: turnResult.currentTurnUserId ?? room?.currentTurnUserId,
    });

    if (room?.feedbackMessage && typeof room.feedbackMessage.edit === 'function') {
      const edited = await editNoituBoardMessage(room.feedbackMessage, errPayload);
      if (edited) return;
    }

    if (typeof channel?.send === 'function') {
      const sent = await channel.send(errPayload).catch(() => null);
      if (room && sent) {
        room.feedbackMessage = sent;
      }
    }
    return;
  }

  // Trường hợp nối từ HỢP LỆ và chuyển sang lượt tiếp theo -> Chỉnh sửa Container V2 hiện tại của bàn đấu!
  await cleanupRoomFeedbackMessage(room);

  const validPayload = buildValidTurnPayload({
    room,
    playerUserId: turnResult.playerUserId,
    acceptedWord: turnResult.acceptedWord,
    nextPrefix: turnResult.nextPrefix,
    nextTurnUserId: turnResult.nextTurnUserId,
    timeoutSec: turnResult.timeoutSec,
  });

  if (room?.boardMessage && typeof room.boardMessage.edit === 'function') {
    const edited = await editNoituBoardMessage(room.boardMessage, validPayload);
    if (edited) return;
  }

  if (typeof channel?.send === 'function') {
    const sent = await channel.send(validPayload).catch(() => null);
    if (room && sent) {
      wordChainSystem.attachBoardMessage(room.roomId, sent);
    }
  }
}

/**
 * Xử lý sự kiện chỉnh sửa tin nhắn (`messageUpdate`) chặn lách luật sửa tin nhắn thành spam @mention.
 */
export async function handleMessageUpdate(
  oldMessage,
  newMessage,
  { guildStore, mentionDetector, punishmentService }
) {
  try {
    if (!newMessage || !guildStore || !mentionDetector || !punishmentService) return;

    if (newMessage.partial && typeof newMessage.fetch === 'function') {
      newMessage = await newMessage.fetch().catch(() => null);
    }
    if (!newMessage || !newMessage.guild || newMessage.system) return;

    const config = guildStore.getConfig(newMessage.guild.id);
    if (!config.enabled) return;

    const botUserId = newMessage.client?.user?.id ?? null;
    const exemption = evaluateExemption(newMessage, config, botUserId);
    if (exemption.exempt) return;

    const violation = mentionDetector.inspectEditedMessage(
      oldMessage,
      newMessage,
      config
    );
    if (!violation) return;

    await punishmentService.enforce({
      message: newMessage,
      violation,
      config,
    });
  } catch (err) {
    logger.error('MessageUpdateEvent', 'Lỗi không mong muốn khi kiểm tra tin nhắn sửa đổi', err);
  }
}
