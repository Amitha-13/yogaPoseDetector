onmessage = function (e) {
  if (e.data.type === "START") {
    const tZero = e.data.tZero;
    const intervalId = setInterval(() => {
      postMessage({
        relative_timestamp: Date.now() - tZero,
        ax: (Math.random() - 0.5) * 4,
        ay: (Math.random() - 0.5) * 4,
        az: (Math.random() - 0.5) * 4,
        gx: (Math.random() - 0.5) * 2,
        gy: (Math.random() - 0.5) * 2,
        gz: (Math.random() - 0.5) * 2,
      });
    }, 20);
    self._intervalId = intervalId;
  }

  if (e.data.type === "STOP") {
    clearInterval(self._intervalId);
    self.close();
  }
};
