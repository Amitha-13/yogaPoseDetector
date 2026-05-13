import socket
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
# Use 127.0.0.1 for local testing
sock.sendto(b"test_data|1,2,3|4,5,6", ("127.0.0.1", 5001))