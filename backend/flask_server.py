"""
Legacy entry point — redirects to the offline data collection server.

ESP32 IMU UDP is now on port 5000 (was 8080).
HTTP/WebSocket API is on port 5001.

Run: python flask_server.py
  or: python data_collection_server.py
"""

from data_collection_server import main

if __name__ == "__main__":
    main()
