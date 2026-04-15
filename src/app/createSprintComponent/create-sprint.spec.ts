import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CreateSprint } from './create-sprint';

describe('CreateSprint', () => {
  let component: CreateSprint;
  let fixture: ComponentFixture<CreateSprint>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CreateSprint]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CreateSprint);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
