require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const OpenAI = require('openai');
const SpotifyWebApi = require('spotify-web-api-node');
const schedule = require('node-schedule');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');
const ytSearch = require('yt-search');

// Setup Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
});

// Grok API setup (OpenAI compatible)
const openai = new OpenAI({
  apiKey: process.env.GROK_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// Limits & Counters (auto reset)
let hourlyCount = 0;
let dailyCount = 0;
const MAX_HOURLY = 100;
const MAX_DAILY = 1000;

// Reset hourly every hour, daily at midnight
schedule.scheduleJob('0 * * * *', () => { 
  hourlyCount = 0; 
  console.log('Hourly count reset');
});
schedule.scheduleJob('0 0 * * *', () => { 
  dailyCount = 0; 
  console.log('Daily count reset');
});

// Rich personality prompt - no memory needed
const systemPrompt = `You're Adi, wise big-bro therapist with fun vibes. Match mood:
- Sad? Mature, supportive (no fluff).
- Happy? Playful slang, emojis, light Hindi ("yaar chill").
- Angry? Calm, positive redirect.
SHORT, punchy replies—yes/no if possible, expand only if asked. Add motivation, quotes, natural humor. End with hook question. 70% pro, 30% fun.`;

// Music queues
const queues = new Map();  // guildId -> { queue: [], player: AudioPlayer, connection: VoiceConnection, preloading: [] }

client.on('ready', async () => {
  console.log(`Adi is online! Logged in as ${client.user.tag}`);

  // Register slash commands
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
      .setDescription('Play a song or playlist (Spotify search or link)')
      .addStringOption(option => 
        option.setName('query')
          .setDescription('Song name, vibe, or Spotify link')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('queue')
      .setDescription('View the queue'),
    new SlashCommandBuilder()
      .setName('skip')
      .setDescription('Skip current song'),
    new SlashCommandBuilder()
      .setName('rps')
      .setDescription('Play Rock-Paper-Scissors against Adi')
      .addStringOption(option => 
        option.setName('choice')
          .setDescription('Your choice: rock, paper, or scissors')
          .setRequired(true)
          .addChoices(
            { name: 'Rock', value: 'rock' },
            { name: 'Paper', value: 'paper' },
            { name: 'Scissors', value: 'scissors' }
          )
      ),
    new SlashCommandBuilder()
      .setName('8ball')
      .setDescription('Ask the Magic 8-Ball a question')
      .addStringOption(option => 
        option.setName('question')
          .setDescription('Your yes/no question')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('trivia')
      .setDescription('Get a random trivia question'),
    new SlashCommandBuilder()
      .setName('meme')
      .setDescription('Get a random meme'),
    new SlashCommandBuilder()
      .setName('tictactoe')
      .setDescription('Play Tic-Tac-Toe')
      .addUserOption(option =>
        option.setName('opponent')
          .setDescription('Challenge a user (or play vs Adi)')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('dnd')
      .setDescription('Roll dice for D&D')
      .addStringOption(option =>
        option.setName('dice')
          .setDescription('Dice to roll (e.g., 1d20, 2d6)')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('animechar')
      .setDescription('Get a random anime character image (waifu, husbando, etc.)')
      .addStringOption(option =>
        option.setName('type')
          .setDescription('Type: waifu (female), husbando (male), neko, kitsune (default: waifu)')
          .setRequired(false)
          .addChoices(
            { name: 'Waifu (female)', value: 'waifu' },
            { name: 'Husbando (male)', value: 'husbando' },
            { name: 'Neko (cat girl)', value: 'neko' },
            { name: 'Kitsune (fox girl)', value: 'kitsune' }
          )
      ),
    new SlashCommandBuilder()
      .setName('react')
      .setDescription('Send an anime reaction GIF (boop, bang, etc.)')
      .addStringOption(option =>
        option.setName('type')
          .setDescription('Reaction type: boop, bang, smash, muah, etc.')
          .setRequired(true)
          .addChoices(
            { name: 'boop (poke)', value: 'boop' },
            { name: 'bang (slap)', value: 'bang' },
            { name: 'smash (yeet)', value: 'smash' },
            { name: 'muah (kiss)', value: 'muah' },
            { name: 'pat', value: 'pat' },
            { name: 'hug (cuddle)', value: 'hug' },
            { name: 'cry', value: 'cry' },
            { name: 'laugh', value: 'laugh' },
            { name: 'smug', value: 'smug' },
            { name: 'wink', value: 'wink' },
            { name: 'kick', value: 'kick' },
            { name: 'bite', value: 'bite' },
            { name: 'blush', value: 'blush' },
            { name: 'bored', value: 'bored' },
            { name: 'dance', value: 'dance' },
            { name: 'facepalm', value: 'facepalm' },
            { name: 'feed', value: 'feed' },
            { name: 'handhold', value: 'handhold' },
            { name: 'happy', value: 'happy' },
            { name: 'highfive', value: 'highfive' },
            { name: 'lurk', value: 'lurk' },
            { name: 'nod', value: 'nod' },
            { name: 'nom', value: 'nom' },
            { name: 'peek', value: 'peek' },
            { name: 'pout', value: 'pout' }
          )
      )
      .addUserOption(option =>
        option.setName('target')
          .setDescription('User to react to (optional)')
          .setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName('truth')
      .setDescription('Get a random truth question')
      .addStringOption(option =>
        option.setName('rating')
          .setDescription('Rating: pg, pg13, r (default: pg)')
          .setRequired(false)
          .addChoices(
            { name: 'PG', value: 'pg' },
            { name: 'PG13', value: 'pg13' },
            { name: 'R', value: 'r' }
          )
      ),
    new SlashCommandBuilder()
      .setName('dare')
      .setDescription('Get a random dare challenge')
      .addStringOption(option =>
        option.setName('rating')
          .setDescription('Rating: pg, pg13, r (default: pg)')
          .setRequired(false)
          .addChoices(
            { name: 'PG', value: 'pg' },
            { name: 'PG13', value: 'pg13' },
            { name: 'R', value: 'r' }
          )
      ),
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands.map(command => command.toJSON()) }
    );
    console.log('Slash commands registered successfully!');
  } catch (error) {
    console.error('Slash registration error:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const serverQueue = queues.get(interaction.guild.id);
    if (!serverQueue) return interaction.reply({ content: 'No queue!', ephemeral: true });

    try {
      if (interaction.customId === 'pause') {
        if (serverQueue.player.state.status === AudioPlayerStatus.Playing) {
          serverQueue.player.pause();
          await interaction.reply({ content: 'Paused! ⏸️', ephemeral: true });
        }
      } else if (interaction.customId === 'resume') {
        if (serverQueue.player.state.status === AudioPlayerStatus.Paused) {
          serverQueue.player.unpause();
          await interaction.reply({ content: 'Resumed! ▶️', ephemeral: true });
        }
      } else if (interaction.customId === 'skip') {
        serverQueue.player.stop();
        await interaction.reply({ content: 'Skipped! ⏭️', ephemeral: true });
      } else if (interaction.customId === 'stop') {
        serverQueue.player.stop();
        serverQueue.queue = [];
        await interaction.reply({ content: 'Stopped and cleared queue! 🛑', ephemeral: true });
      }
    } catch (err) {
      console.error('Button interaction error:', err);
      await interaction.reply({ content: 'Interaction failed—try again! 😅', ephemeral: true });
    }
    return;
  }

  if (!interaction.isCommand()) return;

  await interaction.deferReply(); // Acknowledge immediately to avoid timeout

  if (interaction.commandName === 'adi') {
    if (hourlyCount >= MAX_HOURLY || dailyCount >= MAX_DAILY) {
      return interaction.editReply(`Rate limit reached! 😅\nHourly: ${hourlyCount}/${MAX_HOURLY} | Daily: ${dailyCount}/${MAX_DAILY}\nTry later!`);
    }
    
    hourlyCount++;
    dailyCount++;

    const query = interaction.options.getString('query');
    const userTag = interaction.user.tag;

    try {
      const response = await openai.chat.completions.create({
        model: 'grok-3-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query }
        ],
        max_tokens: 700,
        temperature: 0.8,
      });

      let reply = response.choices[0]?.message?.content?.trim();
      
      if (!reply || reply.length < 2) {
        console.log('Empty/short Grok response for query:', query);
        reply = "Arre yaar, my brain lagged! 😅 Hit me with that question again? 🤔";
      }
      
      const finalReply = reply.includes('@') ? reply : `@${userTag} ${reply}`;
      await interaction.editReply(finalReply);
      
    } catch (error) {
      console.error('Grok API Error:', error);
      await interaction.editReply('Oops, something went wrong—Adi is fixing it! 😅');
    }

  } else if (interaction.commandName === 'adisong') {
    const musicQuery = interaction.options.getString('query')?.trim();
    
    if (!musicQuery) {
      return interaction.editReply('What song or playlist do you want? Give me a name, vibe, or genre! 🎵');
    }

    if (!spotifyApi.getAccessToken()) {
      try {
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
        console.log('Spotify token refreshed');
      } catch (err) {
        console.error('Spotify token error:', err);
        return interaction.editReply('Spotify API error—try later! 😅');
      }
    }

    try {
      let searchRes;
      
      if (musicQuery.toLowerCase().includes('playlist')) {
        searchRes = await spotifyApi.searchPlaylists(musicQuery, { limit: 3 });
        const playlists = searchRes.body.playlists.items;
        
        if (playlists.length === 0) {
          return interaction.editReply(`No playlists found for "${musicQuery}". Try a different query! 🔍`);
        }
        
        let reply = '🎵 **Top Spotify Playlists:**\n';
        playlists.forEach((pl, index) => {
          const owner = pl.owner?.display_name || 'Unknown';
          reply += `${index + 1}. **${pl.name}** by ${owner}\n   ${pl.external_urls.spotify}\n\n`;
        });
        
        return interaction.editReply(reply + 'Click links to open in Spotify! 🎶');
        
      } else {
        searchRes = await spotifyApi.searchTracks(musicQuery, { limit: 3 });
        const tracks = searchRes.body.tracks.items;
        
        if (tracks.length === 0) {
          return interaction.editReply(`No songs found for "${musicQuery}". Try a different query! 🔍`);
        }
        
        let reply = '🎵 **Top Spotify Songs:**\n';
        tracks.forEach((track, index) => {
          const artist = track.artists[0]?.name || 'Unknown Artist';
          reply += `${index + 1}. **${track.name}** by ${artist}\n   ${track.external_urls.spotify}\n\n`;
        });
        
        return interaction.editReply(reply + 'Click links to open in Spotify! 🎶');
      }
      
    } catch (err) {
      console.error('Spotify search error:', err);
      return interaction.editReply('Spotify search failed—try later! 😅');
    }

  } else if (interaction.commandName === 'ticket') {
    const reason = interaction.options.getString('reason') || 'Private chat';
    
    try {
      const ticketChannel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: interaction.guild.roles.everyone,
            deny: ['ViewChannel']
          },
          {
            id: interaction.user.id,
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
          },
          {
            id: client.user.id,
            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory']
          }
        ],
      });
      
      await ticketChannel.send(`🎫 **Private ticket created for ${interaction.user}**\nReason: ${reason}\n\nChat here privately! Use \`/close\` when done.`);
      
      await interaction.editReply(`🔒 Private ticket created: ${ticketChannel}\nLet's talk there!`);
      
    } catch (err) {
      console.error('Ticket creation error:', err);
      await interaction.editReply('Failed to create ticket—check server permissions! 😅');
    }

  } else if (interaction.commandName === 'join') {
    if (!interaction.member.voice.channel) return interaction.editReply('Join a voice channel first! 🎤');
    const connection = joinVoiceChannel({
      channelId: interaction.member.voice.channel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
    });
    const player = createAudioPlayer();
    connection.subscribe(player);
    let serverQueue = queues.get(interaction.guild.id);
    if (!serverQueue) {
      serverQueue = { queue: [], player, connection, preloading: [] };
      queues.set(interaction.guild.id, serverQueue);
    } else {
      serverQueue.connection = connection;
      serverQueue.player = player;
    }
    player.once(AudioPlayerStatus.Idle, () => playNext(interaction.guild.id));
    player.on('error', err => console.error('Player error:', err));
    connection.on(VoiceConnectionStatus.Ready, () => console.log('Joined voice'));
    return interaction.editReply('Joined! 🎶');

  } else if (interaction.commandName === 'play') {
    const query = interaction.options.getString('query').trim();
    if (!query) return interaction.editReply('What song or link? 🎵');
    if (!interaction.member.voice.channel) return interaction.editReply('Join voice first! 🎤');

    let serverQueue = queues.get(interaction.guild.id);
    if (!serverQueue || !serverQueue.connection) {
      const connection = joinVoiceChannel({
        channelId: interaction.member.voice.channel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
      });
      const player = createAudioPlayer();
      connection.subscribe(player);
      serverQueue = { queue: [], player, connection, preloading: [] };
      queues.set(interaction.guild.id, serverQueue);
    }

    if (!spotifyApi.getAccessToken()) {
      try {
        const data = await spotifyApi.clientCredentialsGrant();
        spotifyApi.setAccessToken(data.body['access_token']);
        console.log('Spotify token refreshed');
      } catch (err) {
        console.error('Spotify token error:', err);
        return interaction.editReply('Spotify error! 😅');
      }
    }

    try {
      let tracks = [];
      if (query.startsWith('https://open.spotify.com/')) {
        const urlParts = query.split('/');
        const type = urlParts[3]; // track or playlist
        const id = urlParts[4]?.split('?')[0] || '';
        if (!id) return interaction.editReply('Invalid Spotify link! Use track or playlist.');
        if (type === 'track') {
          const trackData = await spotifyApi.getTrack(id);
          tracks = [trackData.body];
        } else if (type === 'playlist') {
          const playlistData = await spotifyApi.getPlaylistTracks(id, { limit: 50 });
          tracks = playlistData.body.items.map(item => item.track).filter(track => track); // Filter null tracks
        } else {
          return interaction.editReply('Invalid Spotify link! Use track or playlist.');
        }
      } else {
        const searchRes = await spotifyApi.searchTracks(query, { limit: 1 });
        tracks = searchRes.body.tracks.items;
      }

      if (tracks.length === 0) return interaction.editReply(`No songs found! 🔍`);

      let addedCount = 0;
      for (const track of tracks) {
        if (!track) continue; // Skip invalid tracks
        const songTitle = track.name;
        const artist = track.artists[0]?.name || 'Unknown';
        const spotifyUrl = track.external_urls.spotify;
        const thumbnail = track.album.images[0]?.url || '';

        const ytResult = await ytSearch(`${artist} - ${songTitle}`);
        if (!ytResult.videos.length) continue; // Skip if no YT match
        const ytUrl = ytResult.videos[0].url;

        serverQueue.queue.push({ title: songTitle, artist, url: ytUrl, spotify: spotifyUrl, thumbnail, preloaded: false });
        addedCount++;
      }

      if (addedCount === 0) return interaction.editReply('No YT matches found for any tracks! 😕');

      preloadNextSongs(serverQueue);

      const firstSong = serverQueue.queue[serverQueue.queue.length - addedCount]; // Last added first if search
      const embed = new EmbedBuilder()
        .setColor('#1DB954')
        .setTitle(`Added ${addedCount} song${addedCount > 1 ? 's' : ''} to queue`)
        .setDescription(`Starting with: ${firstSong.title} by ${firstSong.artist}\n[Open in Spotify](${firstSong.spotify})`)
        .setThumbnail(firstSong.thumbnail)
        .setFooter({ text: 'Queued by Adi Bot 🎶' });

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setCustomId('pause').setLabel('Pause ⏸️').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('resume').setLabel('Resume ▶️').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('skip').setLabel('Skip ⏭️').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('stop').setLabel('Stop 🛑').setStyle(ButtonStyle.Danger)
        );

      if (serverQueue.player.state.status !== AudioPlayerStatus.Playing) {
        playNext(interaction.guild.id);
      }

      return interaction.editReply({ embeds: [embed], components: [row] });
    } catch (err) {
      console.error('Play error:', err);
      return interaction.editReply('Error—try again! 😅 (Check if Spotify link is valid)');
    }

  } else if (interaction.commandName === 'queue') {
    const serverQueue = queues.get(interaction.guild.id);
    if (!serverQueue || serverQueue.queue.length === 0) return interaction.editReply('Empty queue! 🎶');
    const qList = serverQueue.queue.map((song, i) => `${i + 1}. **${song.title}** by ${song.artist}`).join('\n');
    return interaction.editReply(`**Queue:**\n${qList}`);

  } else if (interaction.commandName === 'skip') {
    const serverQueue = queues.get(interaction.guild.id);
    if (!serverQueue) return interaction.editReply('Nothing playing! 🎵');
    serverQueue.player.stop();
    return interaction.editReply('Skipped! ⏭️');

  } else if (interaction.commandName === 'rps') {
    const userChoice = interaction.options.getString('choice').toLowerCase();
    const choices = ['rock', 'paper', 'scissors'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];

    let result;
    if (userChoice === botChoice) {
      result = 'It\'s a tie! 🤝';
    } else if (
      (userChoice === 'rock' && botChoice === 'scissors') ||
      (userChoice === 'paper' && botChoice === 'rock') ||
      (userChoice === 'scissors' && botChoice === 'paper')
    ) {
      result = 'You win! 🎉';
    } else {
      result = 'I win! 😎';
    }

    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Rock-Paper-Scissors')
      .addFields(
        { name: 'Your Choice', value: userChoice.charAt(0).toUpperCase() + userChoice.slice(1), inline: true },
        { name: 'Adi\'s Choice', value: botChoice.charAt(0).toUpperCase() + botChoice.slice(1), inline: true },
        { name: 'Result', value: result }
      );

    await interaction.editReply({ embeds: [embed] });

  } else if (interaction.commandName === '8ball') {
    const question = interaction.options.getString('question');
    const answers = [
      'Yes, definitely! 👍',
      'No way, bro! ❌',
      'Maybe... ask again? 🤔',
      'Outlook good! 😊',
      'Doubtful. 😕',
      'Absolutely! 🚀',
      'Nah, chill out. 🛑',
      'Signs point to yes. 🔮',
      'Better not tell you now. 😏',
      'Concentrate and ask again. 🧠'
    ];
    const answer = answers[Math.floor(Math.random() * answers.length)];

    const embed = new EmbedBuilder()
      .setColor('#8B4513')
      .setTitle('Magic 8-Ball 🎱')
      .addFields(
        { name: 'Question', value: question },
        { name: 'Answer', value: answer }
      );

    await interaction.editReply({ embeds: [embed] });

  } else if (interaction.commandName === 'trivia') {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch('https://opentdb.com/api.php?amount=1&type=multiple');
      const data = await response.json();
      const question = data.results[0];

      if (!question) throw new Error('No trivia found');

      const decode = (str) => str.replace(/"/g, '"').replace(/'/g, "'").replace(/&/g, '&');

      const answers = [...question.incorrect_answers, question.correct_answer].sort(() => Math.random() - 0.5);
      const correctIndex = answers.indexOf(question.correct_answer) + 1;

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('Trivia Time! 🧠')
        .setDescription(decode(question.question))
        .addFields(
          { name: 'Category', value: question.category, inline: true },
          { name: 'Difficulty', value: question.difficulty, inline: true },
          { name: 'Options', value: answers.map((ans, i) => `${i + 1}. ${decode(ans)}`).join('\n') }
        )
        .setFooter({ text: 'Reply with the number (1-4) to answer!' });

      await interaction.editReply({ embeds: [embed] });

      const filter = m => m.author.id === interaction.user.id && !isNaN(m.content) && parseInt(m.content) >= 1 && parseInt(m.content) <= 4;
      const collector = interaction.channel.createMessageCollector({ filter, time: 30000, max: 1 });

      collector.on('collect', m => {
        const userAnswer = parseInt(m.content);
        const result = userAnswer === correctIndex ? 'Correct! 🎉' : `Wrong! The answer was ${correctIndex}: ${decode(question.correct_answer)} 😕`;
        interaction.followUp(result);
      });

      collector.on('end', collected => {
        if (collected.size === 0) interaction.followUp('Time\'s up! No answer. ⏰');
      });

    } catch (err) {
      console.error('Trivia error:', err);
      await interaction.editReply('Failed to fetch trivia—try again! 😅');
    }

  } else if (interaction.commandName === 'meme') {
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch('https://meme-api.com/gimme');
      const data = await response.json();

      if (!data.url) throw new Error('No meme found');

      const embed = new EmbedBuilder()
        .setColor('#FF69B4')
        .setTitle(data.title || 'Here’s a Meme, Yaar! 😆')
        .setImage(data.url)
        .setFooter({ text: `From r/${data.subreddit} | Adi Bot 🎉` });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Meme error:', err);
      await interaction.editReply('Arre, meme fetch failed! Try again, yaar? 😅');
    }

  } else if (interaction.commandName === 'tictactoe') {
    const opponent = interaction.options.getUser('opponent') || client.user;
    if (opponent.bot && opponent.id !== client.user.id) {
      return interaction.editReply('Can’t play against other bots, yaar! Pick a human or me! 😎');
    }

    const board = Array(9).fill(null);
    let currentPlayer = interaction.user.id;
    let gameActive = true;

    const renderBoard = () => {
      const buttons = [];
      for (let i = 0; i < 9; i += 3) {
        const row = new ActionRowBuilder().addComponents(
          Array.from({ length: 3 }, (_, j) => {
            const index = i + j;
            const label = board[index] || '-';
            return new ButtonBuilder()
              .setCustomId(`ttt_${index}`)
              .setLabel(label)
              .setStyle(board[index] === 'X' ? ButtonStyle.Primary : board[index] === 'O' ? ButtonStyle.Success : ButtonStyle.Secondary)
              .setDisabled(!!board[index] || !gameActive);
          })
        );
        buttons.push(row);
      }
      return buttons;
    };

    const checkWinner = () => {
      const winPatterns = [
        [0,1,2], [3,4,5], [6,7,8],
        [0,3,6], [1,4,7], [2,5,8],
        [0,4,8], [2,4,6]
      ];
      for (const pattern of winPatterns) {
        const [a, b, c] = pattern;
        if (board[a] && board[a] === board[b] && board[a] === board[c]) {
          return board[a];
        }
      }
      return board.every(cell => cell) ? 'Tie' : null;
    };

    const embed = new EmbedBuilder()
      .setColor('#00BFFF')
      .setTitle('Tic-Tac-Toe')
      .setDescription(`${interaction.user} (X) vs ${opponent} (O)\n${interaction.user}'s turn`);

    await interaction.editReply({ embeds: [embed], components: renderBoard() });

    const collector = interaction.channel.createMessageComponentCollector({
      filter: i => i.customId.startsWith('ttt_') && [interaction.user.id, opponent.id].includes(i.user.id),
      time: 60000
    });

    collector.on('collect', async i => {
      if (!gameActive) return;
      if (i.user.id !== currentPlayer) {
        return i.reply({ content: 'Not your turn, yaar! 😛', ephemeral: true });
      }

      const index = parseInt(i.customId.split('_')[1]);
      board[index] = i.user.id === interaction.user.id ? 'X' : 'O';

      const winner = checkWinner();
      if (winner) {
        gameActive = false;
        const result = winner === 'Tie' ? 'It’s a tie! 🤝' : 
                       winner === 'X' ? `${interaction.user} wins! 🎉` : `${opponent} wins! 😎`;
        await i.update({ embeds: [embed.setDescription(result)], components: renderBoard() });
        collector.stop();
        return;
      }

      currentPlayer = currentPlayer === interaction.user.id ? opponent.id : interaction.user.id;
      const nextPlayer = currentPlayer === interaction.user.id ? interaction.user : opponent;
      await i.update({ embeds: [embed.setDescription(`${nextPlayer}'s turn`)], components: renderBoard() });

      if (currentPlayer === client.user.id && gameActive) {
        const empty = board.map((cell, i) => cell ? null : i).filter(i => i !== null);
        if (empty.length) {
          const botMove = empty[Math.floor(Math.random() * empty.length)];
          board[botMove] = 'O';
          const winner = checkWinner();
          if (winner) {
            gameActive = false;
            const result = winner === 'Tie' ? 'It’s a tie! 🤝' : 
                           winner === 'X' ? `${interaction.user} wins! 🎉` : 'I win! 😎';
            await interaction.editReply({ embeds: [embed.setDescription(result)], components: renderBoard() });
            collector.stop();
            return;
          }
          currentPlayer = interaction.user.id;
          await interaction.editReply({ embeds: [embed.setDescription(`${interaction.user}'s turn`)], components: renderBoard() });
        }
      }
    });

    collector.on('end', collected => {
      if (collected.size === 0 || !gameActive) {
        interaction.editReply({ embeds: [embed.setDescription('Game ended! No moves. 😴')], components: [] });
      }
    });

  } else if (interaction.commandName === 'dnd') {
    const diceInput = interaction.options.getString('dice').toLowerCase().trim();
    const diceRegex = /^(\d+)d(\d+)([+-]\d+)?$/;
    if (!diceRegex.test(diceInput)) {
      return interaction.editReply('Invalid dice format! Use NdM[+/-]X (e.g., 2d6, 1d20+2) 🎲');
    }

    const [, count, sides, modifier] = diceInput.match(diceRegex);
    const numDice = parseInt(count);
    const numSides = parseInt(sides);
    const mod = parseInt(modifier || '0');

    if (numDice > 20 || numSides > 100) {
      return interaction.editReply('Too many dice or sides! Max 20 dice, 100 sides. 😅');
    }

    const rolls = Array.from({ length: numDice }, () => Math.floor(Math.random() * numSides) + 1);
    const total = rolls.reduce((sum, roll) => sum + roll, 0) + mod;
    const embed = new EmbedBuilder()
      .setColor('#800080')
      .setTitle('D&D Dice Roll 🎲')
      .addFields(
        { name: 'Dice', value: diceInput, inline: true },
        { name: 'Rolls', value: rolls.join(', '), inline: true },
        { name: 'Total', value: `${total} ${mod ? `(${rolls.join('+')}${mod >= 0 ? '+' : ''}${mod})` : ''}` }
      );

    await interaction.editReply({ embeds: [embed] });

  } else if (interaction.commandName === 'animechar') {
    if (hourlyCount >= MAX_HOURLY || dailyCount >= MAX_DAILY) {
      return interaction.editReply(`Rate limit reached! 😅\nHourly: ${hourlyCount}/${MAX_HOURLY} | Daily: ${dailyCount}/${MAX_DAILY}\nTry later!`);
    }
    hourlyCount++;
    dailyCount++;

    let charType = interaction.options.getString('type') || 'waifu';
    let title = 'Random Anime Char: Waifu! 🌸';
    let isHot = false;
    if (charType.toLowerCase().includes('hot')) {
      isHot = true;
      charType = charType.includes('husbando') ? 'husbando' : 'waifu'; // Fallback
    }
    const typeMap = {
      'waifu': 'waifu',
      'husbando': 'husbando',
      'neko': 'neko',
      'kitsune': 'kitsune'
    };
    const category = typeMap[charType.toLowerCase()] || 'waifu'; // Default waifu if invalid
    if (category === 'husbando') title = 'Random Anime Char: Husbando! 💕';
    if (category === 'neko') title = 'Random Anime Char: Neko! 🐱';
    if (category === 'kitsune') title = 'Random Anime Char: Kitsune! 🦊';

    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`https://nekos.best/api/v2/${category}`);
      const data = await response.json();
      const imageUrl = data.results[0].url;
      const artist = data.results[0].artist_name || 'Unknown';

      const embed = new EmbedBuilder()
        .setColor('#FF69B4')
        .setTitle(title)
        .setImage(imageUrl)
        .setFooter({ text: `Artist: ${artist} | Powered by nekos.best` });

      let replyMsg = '';
      if (isHot) replyMsg = 'API is SFW, yaar—no hot stuff! Showing a cool one instead. 😅\n';
      await interaction.editReply({ content: replyMsg, embeds: [embed] });
    } catch (err) {
      console.error('Anime char error:', err);
      await interaction.editReply('Arre yaar, couldn\'t fetch anime char! Try again or different type? 😅');
    }

  } else if (interaction.commandName === 'react') {
    if (hourlyCount >= MAX_HOURLY || dailyCount >= MAX_DAILY) {
      return interaction.editReply(`Rate limit reached! 😅\nHourly: ${hourlyCount}/${MAX_HOURLY} | Daily: ${dailyCount}/${MAX_DAILY}\nTry later!`);
    }
    hourlyCount++;
    dailyCount++;

    const reactionType = interaction.options.getString('type').toLowerCase();
    const targetUser = interaction.options.getUser('target');
    const reactionMap = {
      'boop': 'poke',
      'bang': 'slap',
      'smash': 'yeet',
      'muah': 'kiss',
      'pat': 'pat',
      'hug': 'cuddle',
      'cry': 'cry',
      'laugh': 'laugh',
      'smug': 'smug',
      'wink': 'wink',
      'kick': 'kick',
      'bite': 'bite',
      'blush': 'blush',
      'bored': 'bored',
      'dance': 'dance',
      'facepalm': 'facepalm',
      'feed': 'feed',
      'handhold': 'handhold',
      'happy': 'happy',
      'highfive': 'highfive',
      'lurk': 'lurk',
      'nod': 'nod',
      'nom': 'nom',
      'peek': 'peek',
      'pout': 'pout',
      'punch': 'punch',
      'shoot': 'shoot',
      'shrug': 'shrug',
      'sleep': 'sleep',
      'smile': 'smile',
      'stare': 'stare',
      'teehee': 'teehee',
      'think': 'think',
      'thumbsup': 'thumbsup',
      'tickle': 'tickle',
      'wave': 'wave',
      'angry': 'angry',
      'baka': 'baka'
    };
    let category = reactionMap[reactionType];
    if (!category) {
      const validTypes = Object.keys(reactionMap).join(', ');
      return interaction.editReply(`Invalid type, yaar! Try one of: ${validTypes}. Or use /react for random? 😅`);
    }

    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`https://nekos.best/api/v2/${category}`);
      const data = await response.json();
      if (!data.results || data.results.length === 0) {
        const randomCategory = Object.values(reactionMap)[Math.floor(Math.random() * Object.values(reactionMap).length)];
        const randomResponse = await fetch(`https://nekos.best/api/v2/${randomCategory}`);
        const randomData = await randomResponse.json();
        if (!randomData.results || randomData.results.length === 0) {
          throw new Error('No GIF found');
        }
        const gifUrl = randomData.results[0].url;
        await interaction.editReply({ content: `No ${reactionType} found, yaar! Here's a random one instead: ${targetUser ? `${targetUser} ` : ''}surprise! 😆`, embeds: [{ image: { url: gifUrl }, footer: { text: 'Powered by nekos.best' } }] });
        return;
      }
      const gifUrl = data.results[0].url;

      const embed = new EmbedBuilder()
        .setColor('#FF69B4')
        .setTitle(`${reactionType.charAt(0).toUpperCase() + reactionType.slice(1)}! 😆`)
        .setImage(gifUrl)
        .setFooter({ text: 'Powered by nekos.best' });

      const mention = targetUser ? `${targetUser} ` : '';
      await interaction.editReply({ content: `${mention}${reactionType}!`, embeds: [embed] });
    } catch (err) {
      console.error('Reaction GIF error:', err);
      await interaction.editReply(`Failed to fetch ${reactionType} GIF, yaar! Try another type? 😅`);
    }

  } else if (interaction.commandName === 'truth') {
    const rating = interaction.options.getString('rating') || 'pg';
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`https://api.truthordarebot.xyz/v1/truth?rating=${rating}`);
      const data = await response.json();

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('Truth Question! 🤔')
        .setDescription(data.question)
        .setFooter({ text: `Rating: ${data.rating.toUpperCase()} | Powered by truthordarebot.xyz` });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Truth error:', err);
      await interaction.editReply('Couldn\'t fetch truth question! Try again or change rating? 😅');
    }

  } else if (interaction.commandName === 'dare') {
    const rating = interaction.options.getString('rating') || 'pg';
    try {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`https://api.truthordarebot.xyz/api/dare?rating=${rating}`);
      const data = await response.json();

      const embed = new EmbedBuilder()
        .setColor('#FF4500')
        .setTitle('Dare Challenge! 🔥')
        .setDescription(data.question)
        .setFooter({ text: `Rating: ${data.rating.toUpperCase()} | Powered by truthordarebot.xyz` });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Dare error:', err);
      await interaction.editReply('Couldn\'t fetch dare! Try again or change rating? 😅');
    }
  }
});

function playNext(guildId) {
  const serverQueue = queues.get(guildId);
  if (!serverQueue || serverQueue.queue.length === 0) {
    serverQueue?.connection?.destroy();
    queues.delete(guildId);
    return;
  }

  const song = serverQueue.queue.shift();
  const stream = ytdl(song.url, { filter: 'audioonly', quality: 'highestaudio', highWaterMark: 1 << 25 });
  const resource = createAudioResource(stream, { inputType: 'webm/opus', inlineVolume: true });
  resource.volume?.setVolume(0.5);
  serverQueue.player.play(resource);

  preloadNextSongs(serverQueue);
}

async function preloadNextSongs(serverQueue) {
  if (!serverQueue || !serverQueue.queue || serverQueue.queue.length === 0) {
    return;
  }
  const preloadCount = 4;
  for (let i = 0; i < Math.min(preloadCount, serverQueue.queue.length); i++) {
    const song = serverQueue.queue[i];
    if (song && !song.preloaded) {
      try {
        await ytdl.getBasicInfo(song.url);
        song.preloaded = true;
      } catch (err) {
        console.error('Preload error:', err);
      }
    }
  }
}

// Error handling
client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

// Login
client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('Failed to login:', error);
});