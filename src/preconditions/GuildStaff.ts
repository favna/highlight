import { orList } from '#utils/misc';
import { bold } from '@discordjs/builders';
import { Precondition } from '@sapphire/framework';
import { PermissionFlagsBits } from 'discord-api-types/v9';
import type { CommandInteraction, Message, Permissions } from 'discord.js';

export class GuildStaff extends Precondition {
	public override async chatInputRun(interaction: CommandInteraction) {
		if (!interaction.inCachedGuild()) {
			return this.error({ message: 'You cannot run this command outside of a server.' });
		}

		const member = await interaction.guild.members.fetch(interaction.user.id);

		return this._sharedRun(member.permissions);
	}

	public override async messageRun(message: Message) {
		if (!message.inGuild()) {
			return this.error({ message: 'You cannot run this command outside of a server.' });
		}

		const member = await message.guild.members.fetch(message.author.id);

		return this._sharedRun(member.permissions);
	}

	private async _sharedRun(permissions: Permissions) {
		if (
			permissions.any(
				[
					// Can manage the entire guild
					PermissionFlagsBits.ManageGuild,
					// Can manage roles
					PermissionFlagsBits.ManageRoles,
					// Can moderate members
					PermissionFlagsBits.ModerateMembers,
				],
				true,
			)
		) {
			return this.ok();
		}

		const permissionList = orList.format(
			['Moderate Members', 'Manage Server', 'Manage Roles'].map((item) => bold(item)),
		);

		return this.error({
			message: `You do not have enough permissions to run this command. Only server members that have one of the following permissions can run this command: ${permissionList}`,
		});
	}
}

declare module '@sapphire/framework' {
	interface Preconditions {
		GuildStaff: never;
	}
}
