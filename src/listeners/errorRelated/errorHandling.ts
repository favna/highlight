import { useErrorWebhook } from '#hooks/useErrorWebhook';
import { withDeprecationWarningForMessageCommands } from '#hooks/withDeprecationWarningForMessageCommands';
import { createErrorEmbed } from '#utils/embeds';
import { orList, pluralize } from '#utils/misc';
import { bold, codeBlock, inlineCode } from '@discordjs/builders';
import { ApplyOptions } from '@sapphire/decorators';
import {
	Awaitable,
	ChatInputCommandErrorPayload,
	Command,
	container,
	ContextMenuCommandErrorPayload,
	Events,
	Listener,
	MessageCommandErrorPayload,
	Piece,
	UserError,
} from '@sapphire/framework';
import {
	MessageSubcommandNoMatchContext,
	SubcommandPluginCommand,
	SubcommandPluginIdentifiers,
} from '@sapphire/plugin-subcommands';
import { InteractionReplyOptions, MessageActionRow, MessageButton, MessageOptions } from 'discord.js';
import { randomUUID } from 'node:crypto';

@ApplyOptions<Listener.Options>({
	name: 'MessageCommandError',
	event: Events.MessageCommandError,
})
export class MessageCommandError extends Listener<typeof Events.MessageCommandError> {
	public override async run(error: unknown, { message, command }: MessageCommandErrorPayload) {
		const maybeError = error as Error;

		await makeAndSendErrorEmbed<MessageOptions>(
			maybeError,
			command,
			(options) =>
				message.channel.send(
					withDeprecationWarningForMessageCommands({
						commandName: command.name,
						guildId: message.guildId,
						receivedFromMessage: true,
						options,
					}),
				),
			command,
		);
	}
}

@ApplyOptions<Listener.Options>({
	name: 'ChatInputCommandError',
	event: Events.ChatInputCommandError,
})
export class ChatInputCommandError extends Listener<typeof Events.ChatInputCommandError> {
	public override async run(error: unknown, { interaction, command }: ChatInputCommandErrorPayload) {
		const maybeError = error as Error;

		await makeAndSendErrorEmbed<InteractionReplyOptions>(
			maybeError,
			command,
			(options) => {
				if (interaction.replied) {
					return interaction.followUp({
						...options,
						ephemeral: true,
					});
				} else if (interaction.deferred) {
					return interaction.editReply(options);
				}

				return interaction.reply({
					...options,
					ephemeral: true,
				});
			},
			command,
		);
	}
}

@ApplyOptions<Listener.Options>({
	name: 'ContextMenuCommandError',
	event: Events.ContextMenuCommandError,
})
export class ContextMenuCommandError extends Listener<typeof Events.ContextMenuCommandError> {
	public override async run(error: unknown, { interaction, command }: ContextMenuCommandErrorPayload) {
		const maybeError = error as Error;

		await makeAndSendErrorEmbed<InteractionReplyOptions>(
			maybeError,
			command,
			(options) => {
				if (interaction.replied) {
					return interaction.followUp({
						...options,
						ephemeral: true,
					});
				} else if (interaction.deferred) {
					return interaction.editReply(options);
				}

				return interaction.reply({
					...options,
					ephemeral: true,
				});
			},
			command,
		);
	}
}

async function makeAndSendErrorEmbed<Options>(
	error: Error | UserError,
	command: Command,
	callback: (options: Options) => Awaitable<unknown>,
	piece: Piece,
) {
	const errorUuid = randomUUID();
	const webhook = useErrorWebhook();
	const { name, location } = piece;

	if (error instanceof UserError) {
		if (error.identifier === SubcommandPluginIdentifiers.MessageSubcommandNoMatch) {
			const casted = command as SubcommandPluginCommand;
			const ctx = error.context as MessageSubcommandNoMatchContext;

			const mappings = casted.parsedSubcommandMappings;

			let foundMessageMapping = mappings.find(
				(m) =>
					(m.type === 'method' && m.name === ctx.possibleSubcommandGroupOrName) ||
					(m.type === 'group' && m.entries.some((entry) => entry.name === ctx.possibleSubcommandGroupOrName)),
			);

			if (foundMessageMapping?.type === 'group') {
				foundMessageMapping = foundMessageMapping.entries.find(
					(m) => m.type === 'method' && m.name === ctx.possibleSubcommandGroupOrName,
				);
			}

			if (!foundMessageMapping) {
				await webhook.send({
					content: `Encountered missing message command mapping for command ${inlineCode(
						command.name,
					)}, subcommand ${inlineCode(ctx.possibleSubcommandGroupOrName!)}. Take a look @here!\nUUID: ${bold(
						inlineCode(errorUuid),
					)}`,
				});

				await callback({
					embeds: [
						createErrorEmbed(
							`😖 I seem to have forgotten to map the ${inlineCode(
								ctx.possibleSubcommandGroupOrName!,
							)} properly for you. Please report this error ID to my developer: ${bold(inlineCode(errorUuid))}!`,
						),
					],
					components: [
						new MessageActionRow().setComponents([
							new MessageButton()
								.setStyle('LINK')
								.setURL(process.env.SUPPORT_SERVER_INVITE!)
								.setEmoji('🆘')
								.setLabel('Support server'),
						]),
					],
				} as never);

				return;
			}

			const actualSubcommandNames = mappings
				.map((entry) => bold(inlineCode(entry.name)))
				.sort((a, b) => a.localeCompare(b));

			const prettyList = orList.format(actualSubcommandNames);

			await callback({
				embeds: [
					createErrorEmbed(
						`The subcommand you provided is unknown to me or you didn't provide any! ${pluralize(
							actualSubcommandNames.length,
							'This is',
							'These are',
						)} the ${pluralize(actualSubcommandNames.length, 'subcommand', 'subcommands')} I know about: ${prettyList}`,
					),
				],
			} as never);

			return;
		}

		const errorEmbed = createErrorEmbed(error.message);

		await callback({
			embeds: [errorEmbed],
			allowedMentions: { parse: [] },
		} as never);

		return;
	}

	container.logger.error(`Encountered error on command ${name} at path ${location.full}`, error);

	await webhook.send({
		content: `Encountered an unexpected error, take a look @here!\nUUID: ${bold(inlineCode(errorUuid))}`,
		embeds: [
			createErrorEmbed(codeBlock('ansi', error.stack ?? error.message))
				.addField('Command', name)
				.addField('Path', location.full),
		],
		allowedMentions: { parse: ['everyone'] },
		avatarURL: container.client.user!.displayAvatarURL(),
		username: 'Error encountered',
	});

	const errorEmbed = createErrorEmbed(
		`Please send the following code to our [support server](${process.env.SUPPORT_SERVER_INVITE}): ${bold(
			inlineCode(errorUuid),
		)}\n\nYou can also mention the following error message: ${codeBlock('ansi', error.message)}`,
	).setTitle('An unexpected error occurred! 😱');

	await callback({
		components: [
			new MessageActionRow().setComponents([
				new MessageButton()
					.setStyle('LINK')
					.setURL(process.env.SUPPORT_SERVER_INVITE!)
					.setEmoji('🆘')
					.setLabel('Support server'),
			]),
		],
		embeds: [errorEmbed],
		allowedMentions: { parse: [] },
	} as never);
}
