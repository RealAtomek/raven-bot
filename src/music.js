/* This program is a Discord bot made using discord.js, a Discord API implementation for node.js
 * Copyright (C) 2021 Adam Říha
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 * 
 * You can contact me, the creator of this program, via this email address: rihaadam1@seznam.cz
 */

const { MessageEmbed, Client } = require('discord.js');
const ytdl = require('ytdl-core');
const yts = require('yt-search');

const geniusLyrics = require('genius-lyrics');
const Genius = new geniusLyrics.Client();

const { sendMsg } = require('./discordFuncs.js');

const queue = new Map();

function findSong(query, message) {
    if (!(query.includes('youtube.com') || query.includes('youtu.be'))) {
        yts({ query: query }, (err, res) => {
            if (err) return sendMsg("Couldn't find video", message.channel);

            queueSong(message, res.videos[0].url, queue.get(message.guild.id));
        });
    }
    else if (query.includes('list=')) {
        let listId = query.slice(
                        query.indexOf('list=') + 5,
                        query.indexOf('index=') != -1 ? query.indexOf('index=') - 1 : undefined
                     );

        yts({ listId: listId }, async (err, playlist) => {
            if (err) return sendMsg("Couldn't find playlist", message.channel);

            for (let i = 0; i < playlist.videos.length; i++) {
                await queueSong(message, `https://youtu.be/${playlist.videos[i].videoId}`, queue.get(message.guild.id));
            }
        });
    }
    else {
        queueSong(message, query, queue.get(message.guild.id));
    }
}

async function queueSong(message, url, serverQueue) {

    // Check if video exists. If so, get videoDetails from the URL
    let songInfo;

    try {
        songInfo = (await ytdl.getInfo(url)).videoDetails;
    } catch (err) {
        return sendMsg("Tak to nezahraju!", message.channel);
    }

    if (!songInfo) return;

// Modify song title and author to try match the official names
    let songTitle = songInfo.title;
    let songAuthor = songInfo.author.name;

    // Remove "- Topic" from author's name
    if (songAuthor.includes(" - Topic") && songInfo.description.includes("Auto-generated by YouTube.")) {
        songAuthor = songAuthor.substring(0, songAuthor.indexOf(" - Topic"));
    }
    // Remove "VEVO" from author's name
    else if (songAuthor.endsWith("VEVO")) {
        songAuthor = songAuthor.substring(0, songAuthor.indexOf("VEVO"));
    }
    // Remove "Official" from author's name
    else if (songAuthor.endsWith(" Official")) {
        songAuthor = songAuthor.substring(0, songAuthor.indexOf(" Official"));
    }

    // Remove author from the title
    if (songTitle.startsWith(songAuthor + " - ") || songTitle.replace(/\s/g, '').substr(0, songAuthor.length) == songAuthor) {
        songTitle = songTitle.substr(songAuthor.length + " - ".length).trimLeft();
        songAuthor = songInfo.title.substring(0, songInfo.title.indexOf(" - "));
    }

    // Remove "(Remastered [year])" from the title
    if (songTitle.substring(songTitle.indexOf("(")).startsWith("(Remastered")) {
        songTitle = songTitle.substr(0, songTitle.indexOf("(Remastered"));
    }
//

    const song = {
        title: songTitle,
        url: songInfo.video_url,
        lengthSeconds: songInfo.lengthSeconds,
        author: songAuthor,
        requestAuthorID: message.author.id,
        thumbnail: songInfo.thumbnails[songInfo.thumbnails.length - 1]
    };

    // Create a queue if one doesn't exist
    if (!serverQueue) {
        const queueContruct = {
            textChannel: message.channel,
            voiceChannel: message.member.voice.channel,
            connection: null,
            songs: [],
            volume: 5,
            playing: true
        };

        queue.set(message.guild.id, queueContruct);
        queueContruct.songs.push(song);

        try {
            let connection = await message.member.voice.channel.join();
            queueContruct.connection = connection;

            play(message.guild, queueContruct.songs[0]);
        } catch (err) {
            console.log(err);
            queue.delete(message.guild.id);

            return sendMsg("err", message.channel);
        }
    }
    
    // If a queue does exist, push the song into it
    else {
        serverQueue.songs.push(song);

        const queuedEmbed = new MessageEmbed()
            .setColor('#202020')
            .setDescription(`Queued [${song.title}](${song.url}) by **${song.author}** [${message.author}]`);
                
        return sendMsg(queuedEmbed, serverQueue.textChannel);
    }
}

function play(guild, song) {
    const serverQueue = queue.get(guild.id);

    if (!song) {
        serverQueue.voiceChannel.leave();
        queue.delete(guild.id);
        return;
    }

    const dispatcher = serverQueue.connection
        .play(ytdl(song.url, { filter: 'audioonly' }))
        .on("finish", () => {
            serverQueue.songs.shift();
            play(guild, serverQueue.songs[0]);
        })
        .on("error", err => {
            console.error("Error while playing music: ", err);
            serverQueue.songs.shift();
            play(guild, serverQueue.songs[0]);
        });

    dispatcher.setVolumeLogarithmic(serverQueue.volume / 7);


    // Now playing - embed
    const nowPlayingEmbed = new MessageEmbed()
        .setColor('#0099ff')
        .setTitle('Now playing')
        .setDescription(`[${song.title}](${song.url}) by **${song.author}** [<@${song.requestAuthorID}>]`);

    sendMsg(nowPlayingEmbed, serverQueue.textChannel);
}

function skipSong(serverQueue, channel) {
    serverQueue.connection.dispatcher.end();

    if (!channel) return sendMsg("Current song has been skipped!", serverQueue.textChannel);
    else          return sendMsg("Current song has been skipped!", channel);
}

function stopPlaying(serverQueue, channel) {
    serverQueue.songs = [];
    serverQueue.connection.dispatcher.end();

    if (!channel) return sendMsg("Stopped playing songs!", serverQueue.textChannel);
    else          return sendMsg("Stopped playing songs!", channel);
}

function getCurrentSong(serverQueue, channel) {
    songLen = serverQueue.songs[0].lengthSeconds;

    let seconds = songLen % 60;
    let minutes = parseInt(songLen / 60) % 60;
    let hours = parseInt(songLen / 3600);

    let time = "";
    if (hours != 0)   time += (hours.toString().length == 1 ? `0${hours}` : hours) + ":";
    if (minutes != 0) time += (minutes.toString().length == 1 && hours != 0 ? `0${minutes}` : minutes) + ":";
                      time += (seconds.toString().length == 1 && minutes != 0 ? `0${seconds}` : seconds);

    const currentEmbed = new MessageEmbed()
        .setColor('#30FF00')
        .setTitle('Current song info')
        .addFields(
            { name: "Title", value: `[${serverQueue.songs[0].title}](${serverQueue.songs[0].url})` },
            { name: "Author", value: serverQueue.songs[0].author, inline: true },
            { name: "Length", value: time, inline: true },
        )
        .setImage(serverQueue.songs[0].thumbnail.url);

    if (!channel) return sendMsg(currentEmbed, serverQueue.textChannel);
    else          return sendMsg(currentEmbed, channel);
}

function getQueuedSongs(serverQueue, channel) {
    let fieldValues = [];

    for (let i = 0; i < serverQueue.songs.length; i++) {
        songLen = serverQueue.songs[i].lengthSeconds;

        let seconds = songLen % 60;
        let minutes = parseInt(songLen / 60) % 60;
        let hours = parseInt(songLen / 3600);

        let songName = serverQueue.songs[i].title;
        let songURL = serverQueue.songs[i].url;

        if (songName.length > 50) fieldValues[i] = `[${songName.substr(0, 46)}](${songURL})...`;
        else                      fieldValues[i] = `[${songName}](${songURL})`;

        fieldValues[i] += ` by **${serverQueue.songs[i].author}** - `;

        if (hours != 0)   fieldValues[i] += (hours.toString().length == 1 ? `0${hours}` : hours) + ":";
        if (minutes != 0) fieldValues[i] += (minutes.toString().length == 1 && hours != 0 ? `0${minutes}` : minutes) + ":";  
                          fieldValues[i] += (seconds.toString().length == 1 && minutes != 0 ? `0${seconds}` : seconds);
    }
            
    fields = [];
    fields.push({ name: "Now playing:", value: fieldValues[0] });
            
    for (let i = 1; i < serverQueue.songs.length; i++)
        fields.push({ name: `${i}.`, value: fieldValues[i] });

    const queueEmbed = new MessageEmbed()
        .setColor('#202020')
        .addFields(fields);

    if (!channel) return sendMsg(queueEmbed, serverQueue.textChannel);
    else          return sendMsg(queueEmbed, channel);
}

async function getLyrics(serverQueue, channel) {
    let searches;

    try {
        searches = await Genius.songs.search(serverQueue.songs[0].title.toLowerCase());
    } catch (err) {
        return;
    }

    if (!searches) {
        return sendMsg("Couldn't find any lyrics for this song!", serverQueue.textChannel);
    }

    const lyrics = await searches[0].lyrics();
    
    const lyricsEmbed = new MessageEmbed()
        .setColor("#FCBA03")
        .setTitle(`Lyrics - ${serverQueue.songs[0].title}`)
        .setDescription(lyrics);

    if (!channel) return sendMsg(lyricsEmbed, serverQueue.textChannel);
    else          return sendMsg(lyricsEmbed, channel);
}

function getQueue() {
    return queue;
}

module.exports = {
    findSong,
    queueSong,
    skipSong,
    stopPlaying,
    getCurrentSong,
    getQueuedSongs,
    getLyrics,
    getQueue
};
