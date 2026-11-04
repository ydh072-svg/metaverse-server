const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 16개 텃밭 기본 데이터 생성
function createDefaultPlots() {
  const plots = [];
  for (let i = 0; i < 16; i++) {
    plots.push({
      plotId: i,
      status: 'empty',
      cropType: null,
      growthStage: 0,
      moisture: 0,
      plantedAt: null,
      owner: null
    });
  }
  return plots;
}

// 채널별 공유 메모리
const worldChannels = {};
function getChannelWorld(channelId) {
  if (!worldChannels[channelId]) {
    worldChannels[channelId] = {
      plots: createDefaultPlots(),
      aquarium: []
    };
  }
  return worldChannels[channelId];
}

// 10초 주기 작물 성장 엔진
setInterval(() => {
  const now = Date.now();
  Object.keys(worldChannels).forEach((channelId) => {
    const world = worldChannels[channelId];
    let hasChange = false;

    world.plots.forEach((plot) => {
      if (plot.status === 'growing' && plot.moisture > 0) {
        const elapsedSec = (now - plot.plantedAt) / 1000;
        plot.moisture = Math.max(0, plot.moisture - 0.5);

        if (elapsedSec >= 60 && plot.growthStage < 3) {
          plot.growthStage = 3;
          plot.status = 'ripe';
          hasChange = true;
        } else if (elapsedSec >= 30 && plot.growthStage < 2) {
          plot.growthStage = 2;
          hasChange = true;
        }
      }
    });

    if (hasChange) {
      io.to(channelId).emit('worldPlotsSync', world.plots);
    }
  });
}, 10000);

io.on('connection', (socket) => {
  let userChannel = 'ch1';

  socket.on('joinChannel', ({ channelId, userData }) => {
    userChannel = channelId || 'ch1';
    socket.join(userChannel);

    const world = getChannelWorld(userChannel);
    socket.emit('initWorldState', {
      plots: world.plots,
      aquarium: world.aquarium
    });
  });

  socket.on('playerMove', (data) => {
    socket.to(userChannel).emit('playerMoved', { ...data, socketId: socket.id });
  });

  socket.on('playerGesture', (data) => {
    socket.to(userChannel).emit('playerGestured', { ...data, socketId: socket.id });
  });

  socket.on('plantSeed', ({ plotId, seedKey, userName }) => {
    const world = getChannelWorld(userChannel);
    const plot = world.plots.find(p => p.plotId === plotId);
    if (plot && plot.status === 'empty') {
      plot.status = 'growing';
      plot.cropType = seedKey;
      plot.growthStage = 1;
      plot.moisture = 70;
      plot.plantedAt = Date.now();
      plot.owner = userName || '초록농부';
      io.to(userChannel).emit('plotUpdated', plot);
    }
  });

  socket.on('waterPlot', ({ plotId }) => {
    const world = getChannelWorld(userChannel);
    const plot = world.plots.find(p => p.plotId === plotId);
    if (plot && plot.status === 'growing') {
      plot.moisture = Math.min(100, plot.moisture + 35);
      io.to(userChannel).emit('plotWatered', { plotId, moisture: plot.moisture });
    }
  });

  socket.on('addFishToAquarium', (fishData) => {
    const world = getChannelWorld(userChannel);
    if (world.aquarium.length < 10) {
      world.aquarium.push(fishData);
      io.to(userChannel).emit('aquariumSync', world.aquarium);
    }
  });

  socket.on('removeFishFromAquarium', ({ fishId }) => {
    const world = getChannelWorld(userChannel);
    const idx = world.aquarium.findIndex(f => f.id === fishId);
    if (idx !== -1) {
      world.aquarium.splice(idx, 1);
      io.to(userChannel).emit('aquariumSync', world.aquarium);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
