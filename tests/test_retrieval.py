from __future__ import annotations

import unittest

from vault_demo.engine import _document_chunks, _identifier_keys, _retrieve_snippets


CASE_ID = "模拟病例SYN0710.txt"
CASE_CONTENT = """模拟病例SYN0710
声明：本文全部信息均为人工合成，仅用于功能测试。

一、病例基本信息
病例代号：SYN-CARD-0710
病例类型：冠状动脉介入术后随访

二、2026 年 7 月 8 日随访数据
家庭血压：128/76 mmHg
实验室检查结果：
血清肌酐：92 μmol/L
估算肾小球滤过率 eGFR：78 mL/min/1.73m²
低密度脂蛋白胆固醇 LDL-C：1.86 mmol/L

三、当前出院医嘱记录
阿司匹林：100 mg，每日一次

四、下一次复查安排
复查日期：2026 年 7 月 22 日
签到时间：09:20
复查地点：心内科随访室 B-12
计划检查项目：十二导联心电图、血常规、肝肾功能、血脂四项。
"""


class RetrievalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.content = CASE_CONTENT
        cls.documents = [
            {
                "id": CASE_ID,
                "title": "模拟病例SYN0710",
                "content": cls.content,
                "contains_sentinel": False,
            },
            {
                "id": "generic_followup.txt",
                "title": "上传随访文档",
                "content": "术后随访需要记录伤口情况、用药依从性和下一次复查时间。",
                "contains_sentinel": False,
            },
        ]

    def test_chunks_preserve_semantic_sections(self) -> None:
        chunks = _document_chunks(self.content)
        lab_chunk = next(chunk for chunk in chunks if "血清肌酐" in chunk["text"])
        followup_chunk = next(chunk for chunk in chunks if "签到时间" in chunk["text"])
        self.assertIn("二、2026 年 7 月 8 日随访数据", lab_chunk["text"])
        self.assertIn("四、下一次复查安排", followup_chunk["text"])

    def test_identifier_alias_matches_hyphenated_case_code(self) -> None:
        self.assertTrue(
            _identifier_keys("病例SYN0710") & _identifier_keys("SYN-CARD-0710")
        )

    def test_retrieves_followup_date_time_and_location(self) -> None:
        snippets = _retrieve_snippets(
            "病例SYN0710下一次复查的具体日期、时间和地点是什么？",
            self.documents,
        )
        self.assertTrue(snippets)
        top = snippets[0]
        self.assertEqual(top["document_id"], CASE_ID)
        self.assertIn("2026 年 7 月 22 日", top["snippet"])
        self.assertIn("09:20", top["snippet"])
        self.assertIn("心内科随访室 B-12", top["snippet"])
        self.assertEqual(len(snippets), 1)

    def test_retrieves_requested_lab_values(self) -> None:
        snippets = _retrieve_snippets(
            "病例SYN0710患者7月8日的肌酐、eGFR和LDL-C分别是多少？",
            self.documents,
        )
        self.assertTrue(snippets)
        top = snippets[0]
        self.assertEqual(top["document_id"], CASE_ID)
        self.assertIn("血清肌酐：92 μmol/L", top["snippet"])
        self.assertIn("eGFR：78 mL/min/1.73m²", top["snippet"])
        self.assertIn("LDL-C：1.86 mmol/L", top["snippet"])


if __name__ == "__main__":
    unittest.main()
