# Rebar AI Training Workflow

1. Collect 5-10 complete records first.
   - Each record should include the original PDF, crops, and the corrected structured JSON/XLSX output.
   - Make sure each wrong/missing item is corrected manually in the collector.

2. Use the records as test data before fine-tuning.
   - Run your rebar app on the same PDFs.
   - Compare AI output to your corrected collector output.
   - Fix the prompt/SKILL.md rules first. Do not fine-tune too early.

3. Build the production app flow.
   - User uploads PDF.
   - App renders pages/images and extracts text.
   - App sends selected pages/crops/text to the model with SKILL.md instructions.
   - Model returns JSON matching the collector schema.
   - App shows the JSON in an editable review screen.

4. Fine-tune later, after 30-100 high-quality examples.
   - Fine-tuning teaches repeated patterns and output format.
   - It does not replace OCR/rendering/crop extraction.
   - Keep SKILL.md even after fine-tuning; use it as runtime instructions.

5. Recommended next test.
   - Gather 5 real plans.
   - For each plan, save: PDF, page images/crops, final corrected JSON.
   - Then test if the app can reproduce the same JSON from the PDF and crops.
