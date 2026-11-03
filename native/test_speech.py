import unittest
from protocol import Observer


class Speech(unittest.TestCase):
    def test_only_final_committed_audio_is_emitted_once(self):
        emitted = []
        observer = Observer('omni', emitted.append, 10, 1000, clock=lambda: 10000)
        observer.begin(9000, 9800)
        observer.event({'type': 'input_audio_buffer.committed', 'item_id': 'a1'})
        observer.event({'type': 'conversation.item.input_audio_transcription.delta', 'item_id': 'a1', 'delta': '大家'})
        self.assertEqual(emitted, [])
        event = {'type': 'conversation.item.input_audio_transcription.completed', 'item_id': 'a1', 'transcript': '大家觉得蓝色好看吗？'}
        observer.event(event)
        observer.event(event)
        self.assertEqual(len(emitted), 1)
        row = emitted[0]['row']
        self.assertEqual((row['kind'], row['at'], row['endedAt'], row['text']), ('audio', 9000, 9800, '大家觉得蓝色好看吗？'))
        self.assertEqual(len(observer.calls), 1, 'ASR与Omni共用既有采集调用，不额外计为回复')

    def test_late_transcript_keeps_its_original_window_and_unknown_or_empty_is_ignored(self):
        emitted = []
        observer = Observer('omni', emitted.append, 10, 1000, clock=lambda: 20000)
        observer.begin(9000, 9800)
        observer.event({'type': 'input_audio_buffer.committed', 'item_id': 'old'})
        observer.begin(18000, 19000)
        observer.event({'type': 'input_audio_buffer.committed', 'item_id': 'new'})
        observer.event({'type': 'conversation.item.input_audio_transcription.completed', 'item_id': 'old', 'transcript': '旧问题'})
        self.assertEqual(emitted[0]['row']['at'], 9000)
        for item, text in [('missing', '不能匹配的语音'), ('new', '   ')]:
            observer.event({'type': 'conversation.item.input_audio_transcription.completed', 'item_id': item, 'transcript': text})
        self.assertEqual(len(emitted), 1)


if __name__ == '__main__':
    unittest.main()
