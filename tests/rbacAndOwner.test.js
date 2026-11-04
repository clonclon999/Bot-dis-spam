import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { executeConfirmationToken } from '../src/commands/admin/confirmStore.js';
import { adminCommand, ownerCommand } from '../src/commands/admin/index.js';
import { BOT_ROLES, HARDCODED_OWNER_ID } from '../src/config/constants.js';
import { createBotSystems } from '../src/systems/index.js';
import {
  hasBotRole,
  isHardcodedOwner,
  resolveBotRole,
} from '../src/utils/permissions.js';

describe('OWNER Hardcoded Privilege (1243061570247069696) & 4-Tier RBAC', () => {
  it('luôn cố định OWNER = 1243061570247069696 và không thể bị ghi đè bởi cơ sở dữ liệu', async () => {
    assert.equal(HARDCODED_OWNER_ID, '1243061570247069696');
    assert.equal(isHardcodedOwner('1243061570247069696'), true);
    assert.equal(isHardcodedOwner('999999999999999999'), false);

    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rbac-test-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db } = systems;
      try {
        // Kể cả chưa có bản ghi nào trong bảng staff_roles, OWNER luôn có toàn quyền
        assert.equal(resolveBotRole(db, HARDCODED_OWNER_ID), BOT_ROLES.OWNER);
        assert.equal(hasBotRole(db, HARDCODED_OWNER_ID, BOT_ROLES.OWNER), true);
        assert.equal(hasBotRole(db, HARDCODED_OWNER_ID, BOT_ROLES.ADMIN), true);
        assert.equal(hasBotRole(db, HARDCODED_OWNER_ID, BOT_ROLES.MODERATOR), true);

        // Phân cấp OWNER > ADMIN > MODERATOR > MEMBER
        db.setStaffRole('admin-101', BOT_ROLES.ADMIN, HARDCODED_OWNER_ID);
        db.setStaffRole('mod-202', BOT_ROLES.MODERATOR, HARDCODED_OWNER_ID);

        assert.equal(resolveBotRole(db, 'admin-101'), BOT_ROLES.ADMIN);
        assert.equal(hasBotRole(db, 'admin-101', BOT_ROLES.OWNER), false);
        assert.equal(hasBotRole(db, 'admin-101', BOT_ROLES.ADMIN), true);

        assert.equal(resolveBotRole(db, 'mod-202'), BOT_ROLES.MODERATOR);
        assert.equal(hasBotRole(db, 'mod-202', BOT_ROLES.ADMIN), false);
        assert.equal(hasBotRole(db, 'mod-202', BOT_ROLES.MODERATOR), true);

        assert.equal(resolveBotRole(db, 'member-303'), BOT_ROLES.MEMBER);
        assert.equal(hasBotRole(db, 'member-303', BOT_ROLES.MODERATOR), false);
      } finally {
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('chặn ADMIN/MEMBER gọi /owner và bắt buộc xác nhận 2 bước cho thao tác nhạy cảm', async () => {
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'owner-cmd-'));
    try {
      const systems = await createBotSystems(tmpDir);
      const { db } = systems;
      try {
        db.setStaffRole('admin-1', BOT_ROLES.ADMIN, HARDCODED_OWNER_ID);

        // 1. ADMIN thường cố gọi /owner role -> Bị từ chối thẳng
        let deniedMsg = null;
        await ownerCommand.execute(
          {
            user: { id: 'admin-1', username: 'SubAdmin' },
            options: { getSubcommand: () => 'audit' },
            reply: async (p) => {
              deniedMsg = p;
            },
          },
          systems
        );
        assert.match(deniedMsg.content, /TRUY CẬP BỊ TỪ CHỐI/);

        // 2. OWNER gọi /owner role cấp quyền ADMIN cho u-staff-9 -> Thành công
        let grantedMsg = null;
        await ownerCommand.execute(
          {
            user: { id: HARDCODED_OWNER_ID, username: 'SupremeOwner' },
            options: {
              getSubcommand: () => 'role',
              getUser: () => ({ id: 'u-staff-9', username: 'NewAdmin' }),
              getString: () => 'ADMIN',
            },
            reply: async (p) => {
              grantedMsg = p;
            },
          },
          systems
        );
        assert.match(grantedMsg.content, /ADMIN/);
        assert.equal(resolveBotRole(db, 'u-staff-9'), BOT_ROLES.ADMIN);

        // 3. OWNER gọi /owner revokeall -> Phải hiện bước xác nhận (chưa xóa ngay!)
        let confirmReply = null;
        await ownerCommand.execute(
          {
            user: { id: HARDCODED_OWNER_ID, username: 'SupremeOwner' },
            options: { getSubcommand: () => 'revokeall' },
            reply: async (p) => {
              confirmReply = p;
            },
          },
          systems
        );
        // Trước khi bấm xác nhận, u-staff-9 vẫn còn quyền ADMIN
        assert.equal(resolveBotRole(db, 'u-staff-9'), BOT_ROLES.ADMIN);

        const customId = confirmReply.components[0].components[0].data.custom_id;
        const token = customId.split(':')[3];

        // Người khác cố xác nhận trộm -> Bị chặn
        await assert.rejects(() => executeConfirmationToken(token, 'admin-1'), /không phải người khởi tạo/);

        // Đích thân OWNER xác nhận -> Toàn bộ quyền ADMIN bị thu hồi ngay lập tức
        await executeConfirmationToken(token, HARDCODED_OWNER_ID);
        assert.equal(resolveBotRole(db, 'u-staff-9'), BOT_ROLES.MEMBER);
        assert.equal(resolveBotRole(db, 'admin-1'), BOT_ROLES.MEMBER);

        // 4. Kiểm tra ADMIN thường không thể bật/tắt Maintenance trong /admin system maintenance
        db.setStaffRole('admin-2', BOT_ROLES.ADMIN, HARDCODED_OWNER_ID);
        let maintDenied = null;
        await adminCommand.execute(
          {
            user: { id: 'admin-2', username: 'AdminTwo' },
            options: {
              getSubcommandGroup: () => 'system',
              getSubcommand: () => 'maintenance',
              getBoolean: () => true,
            },
            reply: async (p) => {
              maintDenied = p;
            },
          },
          systems
        );
        assert.match(maintDenied.content, /OWNER/);
      } finally {
        await db.close();
      }
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
