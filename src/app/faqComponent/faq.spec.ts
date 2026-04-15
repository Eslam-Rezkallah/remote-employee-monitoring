import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FAQ } from './faq';

describe('FAQ', () => {
  let component: FAQ;
  let fixture: ComponentFixture<FAQ>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FAQ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FAQ);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
