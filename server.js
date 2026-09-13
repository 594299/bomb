const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// 创建 HTTP 服务器
const server = http.createServer(app);

// 初始化 Socket.io，配置跨域允许所有前端访问
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// 内存存储：房间列表
// rooms[roomCode] = { hostId, guestId, spectators: [], passwordHash, gameState: {...} }
const rooms = {};

// 生成随机房间号
function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
    console.log(`[连接] 客户端接入: ${socket.id}`);

    // 1. 创建房间 (代替 PeerJS 的 peer.id)
    socket.on('create_room', (data, callback) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            hostId: socket.id,
            guestId: null,
            spectators: [],
            passwordHash: data.passwordHash || null,
            gameState: {} // 存放游戏核心状态
        };
        socket.join(roomCode);
        console.log(`[房间] ${socket.id} 创建了房间 ${roomCode}`);
        if(callback) callback({ success: true, roomCode });
    });

    // 2. 加入房间 (客机或观战者)
    socket.on('join_room', (data, callback) => {
        const { roomCode, passwordHash, role } = data; // role: 'guest' | 'spectator'
        const room = rooms[roomCode];

        if (!room) {
            if(callback) callback({ success: false, reason: 'not_found' });
            return;
        }

        // 密码校验 (如果有密码)
        if (room.passwordHash && room.passwordHash !== passwordHash) {
            if(callback) callback({ success: false, reason: 'wrong_password' });
            return;
        }

        if (role === 'spectator') {
            room.spectators.push(socket.id);
            socket.join(roomCode);
            // 告诉房主有观众来了，让他发一次 sync
            io.to(room.hostId).emit('peer_connected', { peerId: socket.id, role: 'spectator' });
            if(callback) callback({ success: true, role: 'spectator' });
        } else {
            // 作为客机加入
            if (room.guestId) {
                if(callback) callback({ success: false, reason: 'room_full' });
                return;
            }
            room.guestId = socket.id;
            socket.join(roomCode);
            console.log(`[房间] ${socket.id} 作为客机加入了房间 ${roomCode}`);
            
            // 通知房主：客机连上了
            io.to(room.hostId).emit('peer_connected', { peerId: socket.id, role: 'guest' });
            if(callback) callback({ success: true, role: 'guest', hostId: room.hostId });
        }
    });

    // 3. 游戏内消息转发 (暂时作为中继服务器，后续可接管逻辑)
    socket.on('game_msg', (data) => {
        // data = { roomCode, to: 'host'|'guest'|'all', payload: {...} }
        const { roomCode, to, payload } = data;
        const room = rooms[roomCode];
        if(!room) return;

        // 如果是发送状态同步(sync)或者聊天，顺便广播给观战者
        if (payload.type === 'sync' || payload.type === 'chat') {
            room.spectators.forEach(specId => {
                io.to(specId).emit('game_msg', payload);
            });
        }

        if (to === 'host') {
            io.to(room.hostId).emit('game_msg', payload);
        } else if (to === 'guest' && room.guestId) {
            io.to(room.guestId).emit('game_msg', payload);
        } else if (to === 'all') {
            socket.to(roomCode).emit('game_msg', payload);
        }
    });

    // 4. 断开连接处理
    socket.on('disconnect', () => {
        console.log(`[断开] 客户端离线: ${socket.id}`);
        // 查找该客户端在哪个房间
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            if (room.hostId === socket.id) {
                // 房主断开：通知客机和观众，然后销毁房间
                io.to(roomCode).emit('peer_disconnected', { role: 'host' });
                delete rooms[roomCode];
                console.log(`[房间] 房主掉线，销毁房间 ${roomCode}`);
            } else if (room.guestId === socket.id) {
                // 客机断开：通知房主
                room.guestId = null;
                io.to(room.hostId).emit('peer_disconnected', { role: 'guest' });
            } else {
                // 观众断开
                const specIndex = room.spectators.indexOf(socket.id);
                if (specIndex !== -1) {
                    room.spectators.splice(specIndex, 1);
                    io.to(room.hostId).emit('peer_disconnected', { role: 'spectator', peerId: socket.id });
                }
            }
        }
    });
});

// 健康检查接口，给部署平台（如Render）探活使用
app.get('/', (req, res) => {
    res.send('Bomb Game Server is running!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`服务器已启动，监听端口 ${PORT}`);
});