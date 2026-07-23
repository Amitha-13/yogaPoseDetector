/** Consultation-approved guidance, kept independent from UI and recording logic. */
export const POSE_MESSAGES = {
  "STA-02": {
    before: ["Stand comfortably in Samasthiti.", "Keep both feet firmly grounded before lifting one foot.", "Relax your shoulders and lengthen the spine.", "Shift your body weight completely onto the standing leg.", "Place the opposite foot on the inner thigh, never on the knee.", "Bring both palms together in Anjali Mudra at the chest.", "Keep the pelvis level and chest open.", "Fix your gaze on one steady point to improve balance.", "Maintain smooth, natural breathing.", "Begin only when your posture feels stable."],
    after: ["Slowly lower the raised foot back to the floor.", "Return to Samasthiti.", "Relax both arms beside the body.", "Observe your breathing.", "Restore normal balance before continuing.", "Prepare calmly for the next pose."],
  },
  "STA-03": {
    before: ["Stand erect with feet approximately two inches apart.", "Relax your shoulders.", "Keep your spine tall.", "Breathe naturally.", "Inhale gently before beginning.", "Bend forward only from the hips.", "Keep both knees straight without locking them.", "Lengthen the spine throughout the movement.", "Move slowly without jerking."],
    after: ["Return slowly to standing.", "Straighten the spine gradually.", "Relax in Samasthiti.", "Allow your breathing to normalize.", "Avoid sudden movements.", "Prepare comfortably for the next pose."],
  },
  "STA-04-I": {
    before: ["Stand erect with feet together.", "Keep your knees straight but relaxed.", "Place both hands on the lower back for support.", "Open the chest.", "Lengthen the spine.", "Breathe normally.", "Begin the back bend gradually.", "Do not bend suddenly."],
    after: ["Return slowly to the upright position.", "Bring the head up gently.", "Release the hands.", "Stand comfortably.", "Normalize your breathing.", "Relax before the next pose."],
  },
  "STA-04-II": {
    before: ["Stand erect with feet together.", "Relax your body.", "Keep your spine vertical.", "Raise one arm overhead beside the ear.", "Keep the other arm relaxed.", "Maintain pelvis level.", "Keep both knees straight.", "Breathe normally.", "Bend sideways only.", "Do not rotate the trunk."],
    after: ["Return slowly to the centre.", "Lower the raised arm gently.", "Relax both shoulders.", "Restore normal standing posture.", "Observe your breathing.", "Prepare for the opposite side or next pose."],
  },
  "STA-05-I": {
    before: ["Stand erect in Samasthiti.", "Step both feet approximately three feet apart.", "Keep both knees straight.", "Raise both arms sideways to shoulder level.", "Turn the leading foot outward.", "Keep the chest open.", "Lengthen the spine.", "Maintain steady breathing.", "Begin the side bend from the hip.", "Avoid bending forward."],
    after: ["Return slowly to standing.", "Bring both arms back to shoulder level.", "Return to Samasthiti.", "Relax your shoulders.", "Normalize your breathing.", "Repeat on the opposite side if required.", "Prepare for the next pose."],
  },
};

export const getPoseMessages = (pose) => POSE_MESSAGES[pose?.id] ?? null;
