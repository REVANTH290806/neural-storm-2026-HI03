# Manual accessibility checks

Use this checklist with the app running locally and a selectable-text PDF that is safe to use for testing. Automated tests cover the DOM and core behaviors, but they cannot replace testing with real assistive technology.

## Keyboard-only pass

- [ ] Reload the app, press `Tab`, and confirm **Skip to main content** appears with a visible focus outline.
- [ ] Activate the skip link and confirm focus moves to the main learning area.
- [ ] Continue with `Tab` and `Shift+Tab`. Confirm each button, slider, dropdown, source link, disclosure, and answer choice has a visible focus indicator and a sensible order.
- [ ] Upload a PDF using the keyboard file picker. Confirm the upload error and oversized-source notice are announced and understandable.
- [ ] Select and deselect source pages with the keyboard. Confirm the selected page and character counts update, and oversized selections explain what to change.
- [ ] Generate a lesson and question set from a subset of pages. Confirm their cited pages are among the selected pages.
- [ ] Adjust each reading setting with the keyboard. Confirm its value is visible and the text presentation changes.
- [ ] Generate a lesson and a question set. Select an answer, submit it, and move to the next question without using a mouse.
- [ ] Open a source quote disclosure, follow a source-page link, and return to the learning controls.

## VoiceOver and browser pass on macOS

- [ ] In Safari, enable VoiceOver with `Command+F5`. Navigate by headings and form controls; confirm the page title, main heading, labels, control values, loading states, errors, answer feedback, and source links are announced clearly.
- [ ] Repeat the main workflow in Chrome with VoiceOver and note any announcement or focus differences.
- [ ] Confirm the reading preview remains understandable at the largest text size and with the warm and high-contrast backgrounds.
- [ ] Start, pause, resume, and stop speech on a lesson and a source page. Check that speech follows the visible text and that the selected browser voice pronounces the sample text acceptably.
- [ ] Try a narrow viewport and browser zoom at 200%. Confirm controls remain visible, fit the screen, and do not overlap.

Record the browser and operating-system versions, the PDF used, any step that failed, and whether the issue is repeatable. Do not treat passing these checks as a diagnosis or evidence of improved learning outcomes.
