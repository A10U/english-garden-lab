form Measure acoustic signal
    sentence AudioFile
    real PitchFloor 50
    real PitchTop 800
    real FormantCeiling 5500
endform

Read from file: audioFile$
sound = selected("Sound")
pitch = To Pitch (filtered autocorrelation): 0.005, pitchFloor, pitchTop, 15, "no", 0.03, 0.09, 0.50, 0.055, 0.35, 0.14
frames = Get number of frames
writeInfoLine: "ACOUSTICS", tab$, "1"
for frame from 1 to frames
    time = Get time from frame number: frame
    frequency = Get value at time: time, "Hertz", "Linear"
    appendInfoLine: "P", tab$, fixed$(time, 9), tab$, frequency
endfor
for variant from 1 to 3
    ceiling = formantCeiling * (0.8 + 0.1 * variant)
    selectObject: sound
    formant = To Formant (burg): 0.005, 5, ceiling, 0.025, 50
    frames = Get number of frames
    for frame from 1 to frames
        time = Get time from frame number: frame
        f1 = Get value at time: 1, time, "Hertz", "Linear"
        f2 = Get value at time: 2, time, "Hertz", "Linear"
        f3 = Get value at time: 3, time, "Hertz", "Linear"
        b1 = Get bandwidth at time: 1, time, "Hertz", "Linear"
        b2 = Get bandwidth at time: 2, time, "Hertz", "Linear"
        b3 = Get bandwidth at time: 3, time, "Hertz", "Linear"
        appendInfoLine: "F", tab$, variant, tab$, fixed$(time, 9), tab$, f1, tab$, f2, tab$, f3, tab$, b1, tab$, b2, tab$, b3
    endfor
    Remove
endfor
selectObject: sound, pitch
Remove
