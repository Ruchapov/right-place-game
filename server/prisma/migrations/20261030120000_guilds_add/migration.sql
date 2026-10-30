-- Гильдии (docs/guilds.md, 30.10.2026).
--
-- Только ADD COLUMN … DEFAULT и CREATE TABLE — безопасно для ещё живого
-- старого серверного процесса: он новых колонок не перечисляет и новых таблиц
-- не трогает. Написана руками (не migrate dev — тот смотрит в боевую базу).
--
-- Character:
--   eliteTrophies   — элитные трофеи (личная валюта, +1 за событие с элитой);
--   guildLeftAt     — момент выхода/исключения (вступить снова — через 24 ч);
--   reflectPotions  — запас зелья отражения (только из котла гильдии);
--   buffAttack*/buffArmor* — молитвы алтаря: процент и момент конца;
--   cauldronAt / libraryAt — кулдауны котла и библиотеки (16 ч);
--   lastSeenAt      — последний вход (глава неактивен 14 дней).

ALTER TABLE "Character" ADD COLUMN "eliteTrophies" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "guildLeftAt" TIMESTAMP(3);
ALTER TABLE "Character" ADD COLUMN "reflectPotions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "buffAttackPct" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "buffAttackUntil" TIMESTAMP(3);
ALTER TABLE "Character" ADD COLUMN "buffArmorPct" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Character" ADD COLUMN "buffArmorUntil" TIMESTAMP(3);
ALTER TABLE "Character" ADD COLUMN "cauldronAt" TIMESTAMP(3);
ALTER TABLE "Character" ADD COLUMN "libraryAt" TIMESTAMP(3);
ALTER TABLE "Character" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE TABLE "Guild" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "joinMode" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "emblemSymbol" INTEGER NOT NULL,
    "emblemFrame" INTEGER NOT NULL,
    "emblemBg" INTEGER NOT NULL,
    "emblemColor" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "storageLevel" INTEGER NOT NULL DEFAULT 1,
    "cauldronLevel" INTEGER NOT NULL DEFAULT 0,
    "libraryLevel" INTEGER NOT NULL DEFAULT 0,
    "altarLevel" INTEGER NOT NULL DEFAULT 0,
    "gold" INTEGER NOT NULL DEFAULT 0,
    "eliteTrophies" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuildMember" (
    "id" SERIAL NOT NULL,
    "characterId" INTEGER NOT NULL,
    "guildId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuildRequest" (
    "id" SERIAL NOT NULL,
    "guildId" INTEGER NOT NULL,
    "characterId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuildStorage" (
    "id" SERIAL NOT NULL,
    "guildId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "GuildStorage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuildMessage" (
    "id" SERIAL NOT NULL,
    "guildId" INTEGER NOT NULL,
    "characterId" INTEGER,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Guild_name_key" ON "Guild"("name");
CREATE UNIQUE INDEX "Guild_nameKey_key" ON "Guild"("nameKey");
CREATE UNIQUE INDEX "Guild_tag_key" ON "Guild"("tag");
CREATE UNIQUE INDEX "Guild_inviteCode_key" ON "Guild"("inviteCode");
CREATE UNIQUE INDEX "GuildMember_characterId_key" ON "GuildMember"("characterId");
CREATE INDEX "GuildMember_guildId_idx" ON "GuildMember"("guildId");
CREATE UNIQUE INDEX "GuildRequest_guildId_characterId_key" ON "GuildRequest"("guildId", "characterId");
CREATE INDEX "GuildRequest_characterId_idx" ON "GuildRequest"("characterId");
CREATE UNIQUE INDEX "GuildStorage_guildId_kind_ref_key" ON "GuildStorage"("guildId", "kind", "ref");
CREATE INDEX "GuildMessage_guildId_id_idx" ON "GuildMessage"("guildId", "id");

ALTER TABLE "GuildMember" ADD CONSTRAINT "GuildMember_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuildMember" ADD CONSTRAINT "GuildMember_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuildRequest" ADD CONSTRAINT "GuildRequest_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuildRequest" ADD CONSTRAINT "GuildRequest_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuildStorage" ADD CONSTRAINT "GuildStorage_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuildMessage" ADD CONSTRAINT "GuildMessage_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuildMessage" ADD CONSTRAINT "GuildMessage_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;
