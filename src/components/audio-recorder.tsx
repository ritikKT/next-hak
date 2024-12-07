import React, { useEffect, useRef, useState } from 'react';
import debounce from 'lodash/debounce';

const AudioRecorder: React.FC = () => {
    const [transcriptions, setTranscriptions] = useState<string[]>([]);
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    const audioContextRef = useRef<AudioContext | null>(null);

    const processAudioChunk = useRef(
        debounce(async (audioBlob: Blob) => {
            const transcriptionEndpoint = '/apz/transcribe';
            
            try {
                // Lazy initialize AudioContext
                if (!audioContextRef.current) {
                    audioContextRef.current = new AudioContext();
                }
                const audioContext = audioContextRef.current;

                const arrayBuffer = await audioBlob.arrayBuffer();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                // Resample to 16000 Hz PCM
                const offlineCtx = new OfflineAudioContext(
                    1, // Mono
                    audioBuffer.length * (16000 / audioBuffer.sampleRate),
                    16000
                );

                const source = offlineCtx.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(offlineCtx.destination);
                source.start();

                const renderedBuffer = await offlineCtx.startRendering();

                // Convert to raw PCM data
                const pcmData = renderedBuffer.getChannelData(0);
                const int16Buffer = new Int16Array(pcmData.map(sample => 
                    Math.max(-1, Math.min(1, sample)) * 32767
                ));

                const response = await fetch(transcriptionEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'audio/pcm',
                    },
                    body: int16Buffer.buffer
                });

                if (response.ok) {
                    const result = await response.json();
                    
                    // Process the entire array of transcriptions
                    setTranscriptions(prevTranscriptions => {
                        // Get the last (most complete) transcription
                        const latestTranscription = result.transcriptions[result.transcriptions.length - 1];
                        
                        // If it's a new, more complete transcription, add it
                        if (latestTranscription && 
                            !prevTranscriptions.includes(latestTranscription)) {
                            return [...prevTranscriptions, latestTranscription];
                        }
                        return prevTranscriptions;
                    });
                } else {
                    console.error('Transcription failed:', response.statusText);
                }
            } catch (err) {
                console.error('Error processing audio chunk:', err);
            }
        }, 500)
    );

    const startRecording = async () => {
        if (isRecording) return;

        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            const mediaRecorder = new MediaRecorder(mediaStream, { 
                mimeType: 'audio/webm',
                audioBitsPerSecond: 128000 
            });
            
            mediaRecorderRef.current = mediaRecorder;
            chunksRef.current = [];

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    const audioBlob = new Blob([event.data], { type: 'audio/webm' });
                    processAudioChunk.current(audioBlob);
                }
            };

            mediaRecorder.onstop = () => {
                console.log('Recording stopped');
                mediaStream.getTracks().forEach(track => track.stop());
            };

            // Start recording in chunks
            mediaRecorder.start(10000); // 10 seconds per chunk
            setIsRecording(true);
        } catch (err) {
            console.error('Error accessing microphone:', err);
            alert('Please allow microphone access to start recording.');
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
        }
    };

    useEffect(() => {
        startRecording();

        return () => {
            stopRecording();
            
            if (audioContextRef.current) {
                audioContextRef.current.close();
                audioContextRef.current = null;
            }

            processAudioChunk.current.cancel();
        };
    }, []);

    return (
        <div className="p-4">
            <h2 className="text-xl font-bold mb-4">Transcriptions:</h2>
            <div className="max-h-64 overflow-y-auto border p-2">
                {transcriptions.map((transcription, index) => (
                    <p key={index} className="mb-2 border-b last:border-b-0">
                        {transcription}
                    </p>
                ))}
            </div>
            <div className="mt-4 flex space-x-2">
                <button 
                    onClick={stopRecording} 
                    className="bg-red-500 text-white px-4 py-2 rounded"
                >
                    Stop Recording
                </button>
                <button 
                    onClick={() => setTranscriptions([])} 
                    className="bg-blue-500 text-white px-4 py-2 rounded"
                >
                    Clear Transcriptions
                </button>
            </div>
        </div>
    );
};

export default AudioRecorder;