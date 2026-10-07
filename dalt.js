// dalt.js - discord frontend alternative

const API_ENDPOINT = 'https://discord.com/api/v9';

class Dalt {
  constructor() {
    this.token = null;
    this.user = null;
    this.guilds = [];
    this.currentGuild = null;
    this.currentChannel = null;
    this.channels = [];
    this.messages = [];
    this.users = new Map();
    this.websocket = null;
    this.heartbeatInterval = null;
  }

  async login(token) {
    this.token = token;
    
    try {
      // fetch user data
      const userData = await this.apiRequest('/users/@me');
      this.user = userData;
      console.log(`Logged in as ${userData.username}#${userData.discriminator}`);
      
      // fetch guilds (servers)
      this.guilds = await this.apiRequest('/users/@me/guilds');
      console.log(`Loaded ${this.guilds.length} servers`);
      
      await this.connectWebsocket();
      
      return true;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  }
  
  async apiRequest(endpoint, method = 'GET', body = null) {
    const options = {
      method,
      headers: {
        'Authorization': this.token,
        'Content-Type': 'application/json'
      }
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${API_ENDPOINT}${endpoint}`, options);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
  }
  
  async connectWebsocket() {
    const gateway = await this.apiRequest('/gateway');
    const wsUrl = `${gateway.url}/?v=9&encoding=json`;
    
    this.websocket = new WebSocket(wsUrl);
    
    this.websocket.onopen = () => {
      console.log('Connected to Discord gateway');
      
      // identify with the gateway
      this.websocket.send(JSON.stringify({
        op: 2, // identify opcode
        d: {
          token: this.token,
          properties: {
            $os: 'linux',
            $browser: 'discord-alternative',
            $device: 'discord-alternative'
          },
          presence: {
            status: 'online',
            afk: false
          }
        }
      }));
    };
    
    this.websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.op) {
        case 10: // hello
          const heartbeatInterval = data.d.heartbeat_interval;
          this.startHeartbeat(heartbeatInterval);
          break;
          
        case 0: // dispatch
          this.handleDispatch(data);
          break;
      }
    };
    
    this.websocket.onclose = () => {
      console.log('Disconnected from Discord gateway');
      clearInterval(this.heartbeatInterval);
      
      // attempt to reconnect after a delay
      setTimeout(() => this.connectWebsocket(), 5000);
    };
    
    this.websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  
  startHeartbeat(interval) {
    this.heartbeatInterval = setInterval(() => {
      this.websocket.send(JSON.stringify({
        op: 1, // heartbeat opcode
        d: null
      }));
    }, interval);
  }
  
  handleDispatch(data) {
    const { t: event, d: eventData } = data;
    
    switch (event) {
      case 'READY':
        console.log('Ready event received');
        this.user = eventData.user;
        break;
        
      case 'GUILD_CREATE':
        this.updateGuild(eventData);
        break;
        
      case 'MESSAGE_CREATE':
        this.addMessage(eventData);
        this.renderMessages();
        break;
        
      case 'MESSAGE_UPDATE':
        this.updateMessage(eventData);
        this.renderMessages();
        break;
        
      case 'MESSAGE_DELETE':
        this.deleteMessage(eventData.id);
        this.renderMessages();
        break;
    }
  }
  
  updateGuild(guildData) {
    const existingIndex = this.guilds.findIndex(g => g.id === guildData.id);
    
    if (existingIndex !== -1) {
      this.guilds[existingIndex] = {...this.guilds[existingIndex], ...guildData};
    } else {
      this.guilds.push(guildData);
    }
    
    if (guildData.members) {
      guildData.members.forEach(member => {
        this.users.set(member.user.id, member.user);
      });
    }
    
    this.renderGuilds();
  }
  
  async loadGuild(guildId) {
    this.currentGuild = this.guilds.find(g => g.id === guildId);
    
    if (!this.currentGuild) {
      console.error('Guild not found:', guildId);
      return;
    }
    
    this.channels = await this.apiRequest(`/guilds/${guildId}/channels`);
    
    this.renderChannels();
    this.currentChannel = null;
    this.messages = [];
    this.renderMessages();
  }
  
  async loadChannel(channelId) {
    this.currentChannel = this.channels.find(c => c.id === channelId);
    
    if (!this.currentChannel) {
      console.error('Channel not found:', channelId);
      return;
    }
    
    this.messages = await this.apiRequest(`/channels/${channelId}/messages?limit=50`);
    
    this.renderMessages();
  }
  
  async sendMessage(content) {
    if (!this.currentChannel) {
      console.error('No channel selected');
      return;
    }
    
    try {
      const message = await this.apiRequest(
        `/channels/${this.currentChannel.id}/messages`,
        'POST',
        { content }
      );
      
      return message;
    } catch (error) {
      console.error('Failed to send message:', error);
      return null;
    }
  }
  
  addMessage(message) {
    if (message.channel_id === this.currentChannel?.id) {
      // do newer messages first
      this.messages.unshift(message);
    }
  }
  
  updateMessage(message) {
    if (message.channel_id === this.currentChannel?.id) {
      const index = this.messages.findIndex(m => m.id === message.id);
      if (index !== -1) {
        this.messages[index] = {...this.messages[index], ...message};
      }
    }
  }
  
  deleteMessage(messageId) {
    const index = this.messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
      this.messages.splice(index, 1);
    }
  }
  
  renderGuilds() {
    const guildsList = document.getElementById('guilds-list');
    if (!guildsList) return;
    
    guildsList.innerHTML = '';
    
    this.guilds.forEach(guild => {
      const guildElement = document.createElement('div');
      guildElement.className = 'guild';
      guildElement.textContent = guild.name.substring(0, 2).toUpperCase();
      guildElement.title = guild.name;
      guildElement.onclick = () => this.loadGuild(guild.id);
      
      if (guild.icon) {
        const iconUrl = `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`;
        guildElement.style.backgroundImage = `url(${iconUrl})`;
        guildElement.style.backgroundSize = 'cover';
        guildElement.textContent = '';
      }
      
      guildsList.appendChild(guildElement);
    });
  }
  
  renderChannels() {
    const channelsList = document.getElementById('channels-list');
    if (!channelsList) return;
    
    channelsList.innerHTML = '';
    
    // group channels by category n shit
    const categories = new Map();
    const uncategorized = [];
    
    this.channels.forEach(channel => {
      if (channel.type === 4) { // category
        categories.set(channel.id, {
          category: channel,
          channels: []
        });
      } else if (channel.parent_id) {
        const category = categories.get(channel.parent_id);
        if (category) {
          category.channels.push(channel);
        } else {
          uncategorized.push(channel);
        }
      } else {
        uncategorized.push(channel);
      }
    });
    
    // first we gotta render uncategorized channels
    uncategorized
      .filter(c => c.type === 0) // text channels only!!
      .forEach(channel => {
        this.renderChannelItem(channelsList, channel);
      });
    
    // this renders categories and their channels
    categories.forEach(category => {
      const categoryElement = document.createElement('div');
      categoryElement.className = 'category';
      categoryElement.textContent = category.category.name;
      channelsList.appendChild(categoryElement);
      
      category.channels
        .filter(c => c.type === 0) // text channels only!!
        .forEach(channel => {
          this.renderChannelItem(channelsList, channel);
        });
    });
  }
  
  renderChannelItem(parent, channel) {
    const channelElement = document.createElement('div');
    channelElement.className = 'channel';
    channelElement.textContent = `# ${channel.name}`;
    channelElement.onclick = () => this.loadChannel(channel.id);
    parent.appendChild(channelElement);
  }
  
  renderMessages() {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;
    
    messagesList.innerHTML = '';
    
    if (!this.currentChannel) {
      messagesList.innerHTML = '<div class="empty-state">Select a channel to view messages</div>';
      return;
    }
    
    if (this.messages.length === 0) {
      messagesList.innerHTML = '<div class="empty-state">No messages in this channel</div>';
      return;
    }
    
    const messagesByDay = new Map();
    
    this.messages.forEach(message => {
      const date = new Date(message.timestamp);
      const day = date.toDateString();
      
      if (!messagesByDay.has(day)) {
        messagesByDay.set(day, []);
      }
      
      messagesByDay.get(day).push(message);
    });
    
    messagesByDay.forEach((messages, day) => {
      const dayElement = document.createElement('div');
      dayElement.className = 'day-divider';
      dayElement.textContent = day;
      messagesList.appendChild(dayElement);
      
      messages.forEach(message => {
        this.renderMessageItem(messagesList, message);
      });
    });
    
    messagesList.scrollTop = messagesList.scrollHeight;
  }
  
  renderMessageItem(parent, message) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message';
    
    const user = this.users.get(message.author.id) || message.author;
    const timestamp = new Date(message.timestamp).toLocaleTimeString();
    
    messageElement.innerHTML = `
      <div class="message-header">
        <span class="message-author">${user.username}</span>
        <span class="message-timestamp">${timestamp}</span>
      </div>
      <div class="message-content">${this.formatMessageContent(message.content)}</div>
    `;
    
    if (message.attachments && message.attachments.length > 0) {
      const attachmentsElement = document.createElement('div');
      attachmentsElement.className = 'attachments';
      
      message.attachments.forEach(attachment => {
        if (attachment.content_type?.startsWith('image/')) {
          const img = document.createElement('img');
          img.src = attachment.url;
          img.className = 'attachment-image';
          attachmentsElement.appendChild(img);
        } else {
          const link = document.createElement('a');
          link.href = attachment.url;
          link.textContent = attachment.filename;
          link.className = 'attachment-file';
          link.target = '_blank';
          attachmentsElement.appendChild(link);
        }
      });
      
      messageElement.appendChild(attachmentsElement);
    }
    
    parent.appendChild(messageElement);
  }
  
  formatMessageContent(content) {
    if (!content) return '';
    
    // bold
    content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // italic
    content = content.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // underline
    content = content.replace(/__(.*?)__/g, '<u>$1</u>');
    // strikethrough
    content = content.replace(/~~(.*?)~~/g, '<s>$1</s>');
    // code blocks
    content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    // inline code
    content = content.replace(/`([^`]+)`/g, '<code>$1</code>');
    // iser mentions
    content = content.replace(/<@!?(\d+)>/g, (match, id) => {
      const user = this.users.get(id);
      return user ? `<span class="mention">@${user.username}</span>` : match;
    });
    // channel mentions
    content = content.replace(/<#(\d+)>/g, (match, id) => {
      const channel = this.channels.find(c => c.id === id);
      return channel ? `<span class="mention">#${channel.name}</span>` : match;
    });
    // URLs
    content = content.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    
    return content.replace(/\n/g, '<br>');
  }
  
  setupUI() {
    const appContainer = document.getElementById('discord-alternative');
    
    if (!appContainer) {
      console.error('App container not found! Add a div with id="discord-alternative" to your HTML.');
      return;
    }
    
    appContainer.innerHTML = `
      <div class="login-container" id="login-container">
        <h2>Discord Alternative</h2>
        <p>Enter your Discord token to login:</p>
        <input type="password" id="token-input" placeholder="Discord token">
        <button id="login-button">Login</button>
      </div>
      
      <div class="app-container" id="app-container" style="display: none;">
        <div class="servers-sidebar" id="guilds-list"></div>
        
        <div class="channels-sidebar">
          <div class="server-header" id="server-header">Select a server</div>
          <div class="channels-list" id="channels-list"></div>
          <div class="user-area">
            <div class="current-user" id="current-user"></div>
          </div>
        </div>
        
        <div class="chat-area">
          <div class="channel-header" id="channel-header">Select a channel</div>
          <div class="messages-list" id="messages-list"></div>
          <div class="message-input-area">
            <input type="text" id="message-input" placeholder="Send a message">
            <button id="send-button">Send</button>
          </div>
        </div>
      </div>
    `;
    
    document.getElementById('login-button').addEventListener('click', () => {
      const token = document.getElementById('token-input').value;
      if (token) {
        this.login(token).then(success => {
          if (success) {
            document.getElementById('login-container').style.display = 'none';
            document.getElementById('app-container').style.display = 'flex';
            
            const currentUserElement = document.getElementById('current-user');
            currentUserElement.textContent = `${this.user.username}#${this.user.discriminator}`;
            
            this.renderGuilds();
          }
        });
      }
    });
    
    document.getElementById('message-input').addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        const messageInput = document.getElementById('message-input');
        const content = messageInput.value.trim();
        
        if (content) {
          this.sendMessage(content).then(() => {
            messageInput.value = '';
          });
        }
      }
    });
    
    document.getElementById('send-button').addEventListener('click', () => {
      const messageInput = document.getElementById('message-input');
      const content = messageInput.value.trim();
      
      if (content) {
        this.sendMessage(content).then(() => {
          messageInput.value = '';
        });
      }
    });
  }
}


// please improve my styles :( server icons r weird

const style = document.createElement('style');
style.textContent = `
:root {
  --background-primary: #36393f;
  --background-secondary: #2f3136;
  --background-tertiary: #202225;
  --text-normal: #dcddde;
  --text-muted: #a3a6aa;
  --interactive-normal: #b9bbbe;
  --interactive-hover: #dcddde;
  --interactive-active: #ffffff;
  --channels-width: 240px;
  --guilds-width: 72px;
  --spacing: 10px;
  --brand-color: #5865f2;
  --brand-color-hover: #4752c4;
  --green: #3ba55c;
  --shadow-light: 0 1px 0 rgba(4, 4, 5, 0.2);
  --shadow-medium: 0 2px 10px 0 rgba(0, 0, 0, 0.2);
  --font-primary: 'Whitney', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --border-radius-medium: 4px;
  --border-radius-large: 8px;
  --transition-standard: 0.2s ease-out;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-primary);
  background-color: var(--background-primary);
  color: var(--text-normal);
  line-height: 1.4;
}

#discord-alternative {
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.login-container {
  width: 480px;
  max-width: 90%;
  margin: 100px auto;
  padding: 32px;
  background-color: var(--background-secondary);
  border-radius: var(--border-radius-large);
  text-align: center;
  box-shadow: var(--shadow-medium);
}

.login-container h2 {
  margin-bottom: 24px;
  font-size: 24px;
  font-weight: 600;
}

.login-container p {
  margin-bottom: 16px;
  color: var(--text-muted);
}

.login-container input {
  width: 100%;
  padding: 12px;
  margin: 12px 0;
  background-color: var(--background-tertiary);
  border: none;
  border-radius: var(--border-radius-medium);
  color: var(--text-normal);
  font-size: 14px;
  transition: box-shadow var(--transition-standard);
}

.login-container input:focus {
  outline: none;
  box-shadow: 0 0 0 2px var(--brand-color);
}

.login-container button {
  padding: 12px 24px;
  margin-top: 8px;
  background-color: var(--brand-color);
  border: none;
  border-radius: var(--border-radius-medium);
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--transition-standard);
}

.login-container button:hover {
  background-color: var(--brand-color-hover);
}

.app-container {
  display: flex;
  height: 100vh;
}

.servers-sidebar {
  width: var(--guilds-width);
  background-color: var(--background-tertiary);
  padding: var(--spacing);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.guild {
  width: 48px;
  height: 48px;
  background-color: var(--background-secondary);
  border-radius: 10%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-radius var(--transition-standard), background-color var(--transition-standard);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-normal);
  position: relative;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.guild:hover {
  border-radius: 16px;
  background-color: var(--brand-color);
}

.guild:active {
  transform: translateY(1px);
}

.guild::before {
  content: '';
  position: absolute;
  left: -2px;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 0;
  background-color: white;
  border-radius: 0 2px 2px 0;
  transition: height var(--transition-standard);
}

.guild:hover::before {
  height: 20px;
}

.channels-sidebar {
  width: var(--channels-width);
  background-color: var(--background-secondary);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-light);
}

.server-header {
  padding: 16px;
  font-weight: 600;
  font-size: 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.2);
  box-shadow: var(--shadow-light);
  height: 48px;
  display: flex;
  align-items: center;
}

.channels-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing);
}

.category {
  text-transform: uppercase;
  font-size: 12px;
  font-weight: 700;
  margin-top: 16px;
  margin-bottom: 8px;
  color: var(--text-muted);
  letter-spacing: 0.02em;
  padding: 0 8px;
}

.channel {
  padding: 6px 8px;
  margin: 2px 0;
  border-radius: var(--border-radius-medium);
  cursor: pointer;
  color: var(--text-muted);
  font-size: 14px;
  display: flex;
  align-items: center;
  transition: background-color var(--transition-standard), color var(--transition-standard);
}

.channel:hover {
  background-color: rgba(255, 255, 255, 0.05);
  color: var(--text-normal);
}

.channel.active {
  background-color: rgba(255, 255, 255, 0.08);
  color: var(--text-normal);
}

.user-area {
  padding: 10px;
  background-color: rgba(0, 0, 0, 0.2);
  height: 52px;
}

.current-user {
  padding: 8px;
  background-color: var(--background-tertiary);
  border-radius: var(--border-radius-medium);
  display: flex;
  align-items: center;
  font-size: 14px;
}

.chat-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: var(--background-primary);
}

.channel-header {
  padding: 0 16px;
  height: 48px;
  display: flex;
  align-items: center;
  font-weight: 600;
  border-bottom: 1px solid rgba(0, 0, 0, 0.2);
  box-shadow: var(--shadow-light);
  z-index: 1;
}

.messages-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.day-divider {
  text-align: center;
  margin: 28px 0;
  padding: 2px 0;
  font-size: 12px;
  color: var(--text-muted);
  position: relative;
  font-weight: 600;
}

.day-divider::before,
.day-divider::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 42%;
  height: 1px;
  background-color: rgba(255, 255, 255, 0.1);
}

.day-divider::before {
  left: 0;
}

.day-divider::after {
  right: 0;
}

.message {
  margin-bottom: 16px;
  padding: 4px 8px;
  border-radius: var(--border-radius-medium);
  transition: background-color var(--transition-standard);
}

.message:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

.message-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}

.message-author {
  font-weight: 600;
  margin-right: 8px;
  color: var(--interactive-active);
}

.message-timestamp {
  font-size: 11px;
  color: var(--text-muted);
}

.message-content {
  word-wrap: break-word;
  font-size: 15px;
  line-height: 1.4;
}

.mention {
  background-color: rgba(88, 101, 242, 0.3);
  color: #dee0fc;
  padding: 0 2px;
  border-radius: 3px;
  cursor: pointer;
}

.mention:hover {
  background-color: rgba(88, 101, 242, 0.4);
  color: #ffffff;
}

pre {
  background-color: var(--background-tertiary);
  padding: 12px;
  border-radius: var(--border-radius-medium);
  overflow-x: auto;
  margin: 8px 0;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
}

code {
  background-color: var(--background-tertiary);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 85%;
}

.attachments {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attachment-image {
  max-width: 400px;
  max-height: 300px;
  border-radius: var(--border-radius-medium);
  box-shadow: var(--shadow-light);
  transition: transform 0.1s ease-out;
}

.attachment-image:hover {
  transform: scale(1.02);
}

.attachment-file {
  display: inline-block;
  padding: 8px 12px;
  background-color: var(--background-tertiary);
  border-radius: var(--border-radius-medium);
  text-decoration: none;
  color: var(--text-normal);
  font-size: 14px;
  transition: background-color var(--transition-standard);
}

.attachment-file:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 16px;
}

.message-input-area {
  padding: 16px;
  display: flex;
  gap: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.2);
  box-shadow: 0 -1px 0 rgba(255, 255, 255, 0.04);
}

.message-input-area input {
  flex: 1;
  padding: 12px 14px;
  background-color: var(--background-tertiary);
  border: none;
  border-radius: var(--border-radius-medium);
  color: var(--text-normal);
  font-size: 14px;
  transition: box-shadow var(--transition-standard);
}

.message-input-area input:focus {
  outline: none;
  box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.3);
}

.message-input-area button {
  padding: 0 16px;
  background-color: var(--brand-color);
  border: none;
  border-radius: var(--border-radius-medium);
  color: white;
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--transition-standard);
}

.message-input-area button:hover {
  background-color: var(--brand-color-hover);
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background-color: transparent;
}

::-webkit-scrollbar-thumb {
  background-color: var(--background-tertiary);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background-color: #4e5058;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.app-container {
  animation: fadeIn 0.3s ease-out;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  position: absolute;
  bottom: 0;
  right: 0;
  border: 2px solid var(--background-tertiary);
}

.status-online {
  background-color: var(--green);
}

@media (max-width: 768px) {
  .servers-sidebar {
    width: 60px;
  }
  
  .guild {
    width: 42px;
    height: 42px;
    font-size: 14px;
  }
  
  .channels-sidebar {
    width: 200px;
  }
}
`;
document.head.appendChild(style);

document.addEventListener('DOMContentLoaded', () => {
  const client = new Dalt();
  client.setupUI();
});
