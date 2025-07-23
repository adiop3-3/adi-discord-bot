require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('adi')
    .setDescription('Talk to Adi')
    .addStringOption(option => 
      option.setName('query')
        .setDescription('Your question')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('adisong')
    .setDescription('Search for Spotify song/playlist')
    .addStringOption(option => 
      option.setName('query')
        .setDescription('Song or playlist name/vibe')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create private ticket')
    .addStringOption(option => 
      option.setName('reason')
        .setDescription('Reason for ticket')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your voice channel'),
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a song (Spotify search, YouTube stream)')
    .addStringOption(option => 
      option.setName('query')
        .setDescription('Song name or vibe')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('View the queue'),
  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('Skip current song'),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Registering guild-specific slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
    );
    console.log('Successfully registered slash commands for guild!');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
})();