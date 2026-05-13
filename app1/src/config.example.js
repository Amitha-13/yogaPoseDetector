const SENSOR_SLOTS = [
  {
    id: "imu1",
    label: "IMU 1",
    bodyPart: "Right Wrist",
    status: "active",
    color: "#1D9E75",
  },
  {
    id: "imu2",
    label: "IMU 2",
    bodyPart: "Left Wrist",
    status: "active",
    color: "#1D9E75",
  },
  {
    id: "imu3",
    label: "IMU 3",
    bodyPart: "Right Ankle",
    status: "active",
    color: "#1D9E75",
  },
  {
    id: "imu4",
    label: "IMU 4",
    bodyPart: "Left Ankle",
    status: "active",
    color: "#1D9E75",
  },
  {
    id: "imu5",
    label: "IMU 5",
    bodyPart: "Right Knee",
    status: "active",
    color: "#1D9E75",
  },
  {
    id: "imu6",
    label: "IMU 6",
    bodyPart: "Left Knee",
    status: "active",
    color: "#1D9E75",
  },
  {
    id: "imu7",
    label: "IMU 7",
    bodyPart: "Lower Back",
    status: "active",
    color: "#1D9E75",
  },
  {
    id: "imu8",
    label: "IMU 8",
    bodyPart: "Right Shoulder",
    status: "placeholder",
    color: "#6B7280",
  },
  {
    id: "imu9",
    label: "IMU 9",
    bodyPart: "Left Shoulder",
    status: "placeholder",
    color: "#6B7280",
  },
  {
    id: "imu10",
    label: "IMU 10",
    bodyPart: "Head / Neck",
    status: "placeholder",
    color: "#6B7280",
  },
];

const CONFIG = {
  GOOGLE_CLIENT_ID: "YOUR_CLIENT_ID_HERE",
  YOGA_DATASET_FOLDER_ID: "YOUR_FOLDER_ID_HERE",
  LAB_NAME: "Your Lab Name",
  INSTITUTION: "Your Institution",
  FLASK_BASE_URL: "http://127.0.0.1:5000",
  FLASK_DATA_URL: "http://127.0.0.1:5000/data-with-ts",
  FLASK_SYNC_URL: "http://127.0.0.1:5000/sync",
  IMU_POLL_MS: 20,
  SENSOR_SLOTS,
  ACTIVE_SENSOR_COUNT: 7,
  TOTAL_SENSOR_COUNT: 10,
};

export default CONFIG;
